// Local loopback control surface.
//
// The web panel connects to ws://127.0.0.1:{statusPort} from the same machine
// and sends Connector CommandMessages; the agent executes hardware actions and
// replies with AckMessages. A GET / returns a tiny HTML status page; GET
// /health returns JSON for panel presence detection. This is the only native
// UI — deliberately minimal (brand + state + capabilities), per product spec.

import type { CommandMessage, AckMessage, Capability, HelloMessage, AgentInfo } from './protocol';
import { parseMessage, makeAck, makeAckError, encode, PROTOCOL_VERSION } from './protocol';

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

const HTML = (s: AgentStatus) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ankara Yazılım Bağlayıcı</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:40px}
  .card{max-width:640px;margin:0 auto;border:1px solid #1f2d44;border-radius:16px;padding:32px;background:#0f172a}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
  .dot{width:40px;height:40px;border-radius:10px;background:#002147;display:flex;align-items:center;justify-content:center;color:#c9a14a;font-weight:700}
  h1{font-size:20px;margin:0}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #16203a;font-size:14px}
  .row span:last-child{color:#9fb3cf;text-align:right}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;background:#13203a;border:1px solid #1f2d44;font-size:12px;margin:3px 4px 0 0}
  .ok{color:#34d399}.warn{color:#fbbf24}
</style></head><body><div class="card">
  <div class="brand"><div class="dot">A</div><h1>Ankara Yazılım Bağlayıcı</h1></div>
  <div class="row"><span>Durum</span><span class="${s.paired ? 'ok' : 'warn'}">${s.paired ? 'Bağlı' : 'Eşleştirilmemiş'}</span></div>
  <div class="row"><span>Cihaz</span><span>${s.deviceId ?? '—'}</span></div>
  <div class="row"><span>Etiket</span><span>${s.label ?? '—'}</span></div>
  <div class="row"><span>Sunucu</span><span>${s.apiBase}</span></div>
  <div class="row"><span>Yazıcı</span><span>${s.printer ? `${s.printer.host}:${s.printer.port}` : 'Yapılandırılmadı'}</span></div>
  <div class="row"><span>Başlangıç</span><span>${s.startedAt}</span></div>
  <div style="margin-top:16px"><strong style="font-size:13px">Yetenekler</strong><div style="margin-top:8px">
    ${s.capabilities.map((c) => `<span class="pill">${c}</span>`).join('')}</div></div>
</div></body></html>`;

export function startStatusServer(
  port: number,
  status: () => AgentStatus,
  handler: (cap: Capability) => CommandHandler | null,
  agent: () => AgentInfo,
): void {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  Bun.serve({
    port,
    websocket: {
      open(ws) {
        const s = status();
        const hello: HelloMessage = {
          kind: 'hello',
          v: PROTOCOL_VERSION,
          agent: agent(),
          capabilities: s.capabilities,
        };
        ws.send(encode(hello));
      },
      async message(ws, msg) {
        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg as ArrayBuffer);
        const parsed = parseMessage(text);
        if (!parsed.ok) {
          ws.send(encode(makeAckError('bad-json', parsed.error.message)));
          return;
        }
        const m = parsed.value;
        if (m.kind !== 'command') {
          // We only accept commands from the panel; events flow the other way.
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
      close() {},
    },

    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (url.pathname === '/health') {
        return Response.json({ ok: true, ...status() }, { headers: corsHeaders });
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
  console.log(`Bağlayıcı durum sunucusu: http://127.0.0.1:${port} (ws://127.0.0.1:${port})`);
}
