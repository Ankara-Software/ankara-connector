// Local loopback control surface.
//
// The web panel connects to ws://127.0.0.1:{statusPort} from the same machine
// and sends Connector CommandMessages; the agent executes hardware actions and
// replies with AckMessages. A GET / returns a tiny HTML status page; GET
// /health returns JSON for panel presence detection. This is the only native
// UI — deliberately minimal (brand + state + capabilities), per product spec.

import { buildAboutHtml } from './about-html';
import { deliverAuthCallback, type AuthCallbackPayload } from './auth-flow';
import { loadConfig, saveConfig, type PrinterConfig } from './config';
import { bufferDeviceEvent, bufferedEventCount, replayBufferedEvents } from './event-bridge';
import { BUN_BUILD_VERSION, CONNECTOR_BUILD } from './generated/build-info';
import { STATUS_LOGO_PNG } from './generated/tray-logo';
import { logLine } from './logger';
import type { AckMessage, AgentInfo, Capability, CommandMessage, HelloMessage } from './protocol';
import { decode, encode, makeAck, makeAckError, makeEvent, PROTOCOL_VERSION } from './protocol';
import { buildStatusHtml, buildTrustCertResultHtml } from './status-html';
import { isCertTrusted, trustLocalhostCert } from './tls-cert';
import { pendingUpdateSummary } from './update';

/** Origins allowed to talk to the loopback API (roadmap §24, enterprise §1).
 *  Only the production panel + local dev servers may issue commands; a random
 *  website on the user's machine must never reach the printer or barrier. */
const ALLOWED_ORIGINS = new Set([
  'https://ankarayazilim.org',
  'https://www.ankarayazilim.org',
  'https://panel.ankarayazilim.org',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/** Origins allowed to POST device tokens to the localhost callback (web auth page). */
const AUTH_CALLBACK_ORIGINS = ALLOWED_ORIGINS;

export interface AgentStatus {
  paired: boolean;
  deviceId: string | null;
  label: string | null;
  tenantName: string | null;
  pairedAt: string | null;
  apiBase: string;
  capabilities: Capability[];
  printer: { host: string; port: number } | null;
  startedAt: string;
  version: string;
  sessionPaused: boolean;
}

export interface StatusServerHooks {
  onLogout?: () => { ok: true } | { ok: false; error: string };
  onLogin?: () => Promise<
    | { ok: true; started: true }
    | { ok: false; error: string }
  >;
  onApplyUpdate?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export type CommandHandler = (
  cmd: CommandMessage,
) => Promise<{ payload?: unknown; error?: { code: string; message: string } }>;

/** Connected panel WebSocket clients — receive unsolicited hardware events. */
const wsClients = new Set<{ send: (data: string) => void }>();

/** True when at least one panel WS client is currently connected. */
export function isPanelWsConnected(): boolean {
  return wsClients.size > 0;
}

export function broadcastConnectorEvent(cap: Capability, event: string, payload?: unknown): void {
  // Offline durability (roadmap §32): if no panel client is connected, buffer
  // the event locally so it can be replayed on the next connect instead of
  // being silently dropped.
  if (wsClients.size === 0) {
    const cfg = loadConfig();
    const deviceId = cfg.deviceId ?? 'unpaired';
    bufferDeviceEvent({ deviceId, cap: String(cap), event, payload });
    return;
  }
  const msg = makeEvent(cap, event, payload);
  const wire = encode(msg);
  for (const ws of wsClients) {
    try {
      ws.send(wire);
    } catch {
      wsClients.delete(ws);
    }
  }
}

const AUTH_OK_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connector bağlandı</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b1220;color:#e6edf7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{max-width:420px;text-align:center;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  h1{font-size:22px;margin:0 0 12px;color:#34d399}
  p{color:#9fb3cf;font-size:15px;line-height:1.5;margin:0}
</style></head><body><div class="card">
  <h1>Bağlantı tamam</h1>
  <p>Connector bu bilgisayarda çalışmaya devam ediyor. Bu pencereyi kapatabilirsiniz — oturumunuz kalıcı olarak hatırlanır.</p>
</div></body></html>`;

export function startStatusServer(
  port: number,
  status: () => AgentStatus,
  handler: (cap: Capability) => CommandHandler | null,
  agent: () => AgentInfo,
  tls?: { cert: string; key: string } | null,
  hooks: StatusServerHooks = {},
): void {
  const corsHeadersFor = (origin: string | null): Record<string, string> => {
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        Vary: 'Origin',
      };
    }
    // No reflected origin for disallowed callers; still answer preflight minimally.
    return {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
    };
  };

  function authCorsHeaders(origin: string | null): Record<string, string> {
    if (origin && AUTH_CALLBACK_ORIGINS.has(origin)) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      };
    }
    return corsHeadersFor(origin);
  }

  Bun.serve({
    port,
    ...(tls ? { tls: { cert: tls.cert, key: tls.key } } : {}),
    websocket: {
      open(ws) {
        wsClients.add(ws);
        const s = status();
        const hello: HelloMessage = {
          kind: 'hello',
          v: PROTOCOL_VERSION,
          agent: agent(),
          capabilities: s.capabilities,
        };
        ws.send(encode(hello));
        // Replay buffered events (roadmap §32) so a reconnecting panel does not
        // lose device events that arrived while it was offline.
        const deviceId = s.deviceId ?? 'unpaired';
        void replayBufferedEvents(deviceId, (wire) => ws.send(wire), (cap, event, pl) => encode(makeEvent(cap as Capability, event, pl)))
          .then((n) => {
            if (n > 0) logLine('info', `status: ${n} arabellekli olay panele yeniden oynandı.`);
          })
          .catch(() => {});
      },
      async message(ws, msg) {
        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg as unknown as ArrayBuffer);
        const parsed = decode(text);
        if (!parsed.ok) {
          ws.send(encode(makeAckError('bad-json', parsed.error.code, parsed.error.message)));
          return;
        }
        const m = parsed.value;
        if (m.kind !== 'command') {
          return;
        }
        const h = handler(m.cap);
        if (!h) {
          ws.send(encode(makeAckError(m.id, 'unknown_capability', 'Bu yetenek bu cihazda yok.')));
          return;
        }
        try {
          const r = await h(m);
          const ack: AckMessage = r.error
            ? makeAckError(m.id, r.error.code, r.error.message)
            : makeAck(m.id, r.payload);
          ws.send(encode(ack));
        } catch (e) {
          ws.send(encode(makeAckError(m.id, 'device_error', (e as Error).message)));
        }
      },
      close(ws) {
        wsClients.delete(ws);
      },
    },

    fetch(req, server) {
      const url = new URL(req.url);
      const origin = req.headers.get('origin');
      const corsHeaders = corsHeadersFor(origin);

      if (url.pathname === '/auth/callback') {
        const acHeaders = authCorsHeaders(origin);
        if (req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: acHeaders });
        }
        if (req.method === 'POST') {
          return req
            .json()
            .then((body: unknown) => {
              const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
              const payload: AuthCallbackPayload = {
                state: String(b.state || ''),
                token: String(b.token || ''),
                deviceId: String(b.deviceId || ''),
                tenantId: b.tenantId ? String(b.tenantId) : undefined,
                tenantName: b.tenantName ? String(b.tenantName) : undefined,
              };
              if (!payload.state || !payload.token || !payload.deviceId) {
                return Response.json(
                  { ok: false, error: 'Eksik alanlar.' },
                  { status: 400, headers: acHeaders },
                );
              }
              const delivered = deliverAuthCallback(payload);
              if (!delivered) {
                return Response.json(
                  { ok: false, error: 'Geçersiz veya süresi dolmuş oturum.' },
                  { status: 409, headers: acHeaders },
                );
              }
              return new Response(AUTH_OK_HTML, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8', ...acHeaders },
              });
            })
            .catch(() =>
              Response.json({ ok: false, error: 'Geçersiz istek.' }, { status: 400, headers: acHeaders }),
            );
        }
        return new Response('Method Not Allowed', { status: 405, headers: acHeaders });
      }

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (url.pathname === '/health') {
        const pending = pendingUpdateSummary();
        return Response.json(
          {
            ok: true,
            ...status(),
            tls: !!tls,
            certTrusted: tls ? isCertTrusted() : true,
            bufferedEvents: bufferedEventCount(),
            pendingUpdate: pending
              ? { version: pending.version, filename: pending.filename }
              : null,
            runtime: {
              bun: typeof Bun !== 'undefined' ? Bun.version : BUN_BUILD_VERSION,
              platform: process.platform,
              arch: process.arch,
              build: CONNECTOR_BUILD,
            },
          },
          { headers: corsHeaders },
        );
      }
      if (url.pathname === '/about' || url.pathname === '/about/') {
        const trayVersion = url.searchParams.get('tray') || undefined;
        const trayBuild = url.searchParams.get('tbuild') || undefined;
        const s = status();
        return new Response(
          buildAboutHtml({
            version: s.version,
            trayVersion,
            trayBuild,
            runtime: {
              bun: typeof Bun !== 'undefined' ? Bun.version : BUN_BUILD_VERSION,
              platform: process.platform,
              arch: process.arch,
              build: CONNECTOR_BUILD,
            },
          }),
          { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } },
        );
      }
      if (url.pathname === '/trust-cert' || url.pathname === '/trust-cert/') {
        if (req.method === 'POST') {
          const ok = trustLocalhostCert();
          return Response.json(
            ok ? { ok: true } : { ok: false, error: 'Sertifika güven deposuna eklenemedi.' },
            { status: ok ? 200 : 500, headers: corsHeaders },
          );
        }
        if (req.method === 'GET') {
          const ok = trustLocalhostCert();
          return new Response(buildTrustCertResultHtml(ok), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
          });
        }
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }
      if (url.pathname === '/session/logout' && req.method === 'POST') {
        if (!hooks.onLogout) {
          return Response.json({ ok: false, error: 'Desteklenmiyor.' }, { status: 501, headers: corsHeaders });
        }
        const r = hooks.onLogout();
        return Response.json(r, { status: r.ok ? 200 : 400, headers: corsHeaders });
      }
      if (url.pathname === '/session/login' && req.method === 'POST') {
        if (!hooks.onLogin) {
          return Response.json({ ok: false, error: 'Desteklenmiyor.' }, { status: 501, headers: corsHeaders });
        }
        return hooks
          .onLogin()
          .then((r) => Response.json(r, { status: r.ok ? 200 : 409, headers: corsHeaders }))
          .catch((e) =>
            Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: corsHeaders }),
          );
      }
      if (url.pathname === '/update/apply' && req.method === 'POST') {
        if (!hooks.onApplyUpdate) {
          return Response.json({ ok: false, error: 'Desteklenmiyor.' }, { status: 501, headers: corsHeaders });
        }
        return hooks
          .onApplyUpdate()
          .then((r) => Response.json(r, { status: r.ok ? 200 : 400, headers: corsHeaders }));
      }
      if (url.pathname === '/assets/logo.png') {
        return new Response(STATUS_LOGO_PNG, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...corsHeaders },
        });
      }
      if (url.pathname === '/config/printer') {
        if (req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: corsHeaders });
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          return req
            .json()
            .then((body: unknown) => {
              const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
              const host = String(b.host || '').trim();
              const port = Number(b.port ?? 9100);
              if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
                return Response.json(
                  { ok: false, error: 'Geçerli yazıcı IP/host ve port (1-65535) gerekli.' },
                  { status: 400, headers: corsHeaders },
                );
              }
              const cfg = loadConfig();
              const printer: PrinterConfig = {
                host,
                port: Math.trunc(port),
                codePage: b.codePage != null ? Number(b.codePage) : cfg.printer?.codePage,
              };
              saveConfig({ ...cfg, printer });
              return Response.json({ ok: true, printer }, { headers: corsHeaders });
            })
            .catch(() =>
              Response.json({ ok: false, error: 'Geçersiz istek.' }, { status: 400, headers: corsHeaders }),
            );
        }
        if (req.method === 'DELETE') {
          const cfg = loadConfig();
          saveConfig({ ...cfg, printer: null });
          return Response.json({ ok: true, printer: null }, { headers: corsHeaders });
        }
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }
      if (url.pathname === '/extension/session') {
        const cfg = loadConfig();
        if (!cfg.token || !cfg.deviceId) {
          return Response.json({ paired: false }, { headers: corsHeaders });
        }
        return Response.json(
          {
            paired: true,
            token: cfg.token,
            deviceId: cfg.deviceId,
            apiBase: cfg.apiBase.replace(/\/$/, ''),
            tenantName: cfg.tenantName ?? null,
            label: cfg.label ?? null,
          },
          { headers: corsHeaders },
        );
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(
          buildStatusHtml(status(), { tlsEnabled: !!tls, certTrusted: tls ? isCertTrusted() : true }),
          { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } },
        );
      }
      if (server.upgrade(req)) return;
      return new Response('Not Found', { status: 404 });
    },
  });
  console.log(
    `Connector durum sunucusu: ${tls ? 'https' : 'http'}://127.0.0.1:${port} (${tls ? 'wss' : 'ws'}://127.0.0.1:${port})`,
  );
}
