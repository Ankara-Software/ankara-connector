// Local loopback control surface.
//
// The web panel connects to ws://127.0.0.1:{statusPort} from the same machine
// and sends Connector CommandMessages; the agent executes hardware actions and
// replies with AckMessages. A GET / returns a tiny HTML status page; GET
// /health returns JSON for panel presence detection. This is the only native
// UI — deliberately minimal (brand + state + capabilities), per product spec.

import { deliverAuthCallback, type AuthCallbackPayload } from './auth-flow';
import { loadConfig, saveConfig, type PrinterConfig } from './config';
import type { AckMessage, AgentInfo, Capability, CommandMessage, HelloMessage } from './protocol';
import { decode, encode, makeAck, makeAckError, makeEvent, PROTOCOL_VERSION } from './protocol';
import { bufferDeviceEvent, replayBufferedEvents, bufferedEventCount } from './event-bridge';
import { logLine } from './logger';

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
  apiBase: string;
  capabilities: Capability[];
  printer: { host: string; port: number } | null;
  startedAt: string;
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

const HTML = (s: AgentStatus) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ankara Yazılım Connector</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:40px}
  .card{max-width:640px;margin:0 auto;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
  .brand img{height:40px;width:auto}
  h1{font-size:20px;margin:0}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #16203a;font-size:14px}
  .row span:last-child{color:#9fb3cf;text-align:right}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;background:#13203a;border:1px solid #1f2d44;font-size:12px;margin:3px 4px 0 0}
  .ok{color:#34d399}.warn{color:#fbbf24}
</style></head><body><div class="card">
  <div class="brand"><img src="https://ankarayazilim.org/ankara-yazilim.png" alt="Ankara Yazılım" width="160" height="40"/><h1>Connector</h1></div>
  <div class="row"><span>Durum</span><span class="${s.paired ? 'ok' : 'warn'}">${s.paired ? 'Bağlı' : 'Oturum bekleniyor'}</span></div>
  <div class="row"><span>Cihaz</span><span>${s.deviceId ?? '—'}</span></div>
  <div class="row"><span>Etiket</span><span>${s.label ?? '—'}</span></div>
  <div class="row"><span>Sunucu</span><span>${s.apiBase}</span></div>
  <div class="row"><span>Yazıcı</span><span>${s.printer ? `${s.printer.host}:${s.printer.port}` : 'Panelden yapılandırın'}</span></div>
  <div class="row"><span>Başlangıç</span><span>${s.startedAt}</span></div>
  <div style="margin-top:16px"><strong style="font-size:13px">Yetenekler</strong><div style="margin-top:8px">
    ${s.capabilities.map((c) => `<span class="pill">${c}</span>`).join('')}</div></div>
</div></body></html>`;

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
        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg as ArrayBuffer);
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
        return Response.json({ ok: true, ...status(), bufferedEvents: bufferedEventCount() }, { headers: corsHeaders });
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
        return new Response(HTML(status()), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
        });
      }
      if (server.upgrade(req)) return;
      return new Response('Not Found', { status: 404 });
    },
  });
  console.log(
    `Connector durum sunucusu: ${tls ? 'https' : 'http'}://127.0.0.1:${port} (${tls ? 'wss' : 'ws'}://127.0.0.1:${port})`,
  );
}
