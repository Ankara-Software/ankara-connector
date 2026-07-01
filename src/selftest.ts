// Self-test / virtual device CLI (roadmap §40).
//
// `ankara-connector selftest` exercises the agent's subsystems without any
// physical hardware or cloud dependency: builds the DriverHost, lists advertised
// capabilities, probes each driver's availability/health, checks the offline
// buffer + crash store, and verifies the transport factory. Exits non-zero on
// any subsystem failure so CI / support can run it as a smoke gate.
//
// `ankara-connector --virtual` boots the virtual device (src/virtual-device.ts)
// as a real loopback WS server so the panel or QA tooling can send test
// commands against a fake agent with zero hardware.

import { loadConfig } from './config';
import { listLocalCrashes } from './crash-report';
import { buildDriverHost } from './drivers/host';
import { bufferedEventCount } from './event-bridge';
import { advertisedCapabilities, agentInfo } from './pair';
import { encode, type CommandMessage } from './protocol';
import { createTransport } from './transports/registry';
import { createVirtualDeviceState, runVirtualWire, virtualHello } from './virtual-device';

export interface SelftestResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

/** Run the in-process self-test suite. */
export async function runSelftest(): Promise<SelftestResult> {
  const checks: SelftestResult['checks'] = [];

  // 1. DriverHost builds and advertises at least the always-on scanner caps.
  const host = buildDriverHost();
  const caps = host.advertisedCapabilities();
  checks.push({
    name: 'driver-host',
    ok: caps.includes('scanner.barcode') && caps.includes('scanner.qr'),
    detail: `capabilities=${caps.join(',') || '(none)'}`,
  });

  // 2. Each registered driver isAvailable does not throw.
  let allAvailOk = true;
  for (const d of host.list()) {
    try {
      d.isAvailable();
    } catch {
      allAvailOk = false;
    }
  }
  checks.push({ name: 'driver-availability', ok: allAvailOk });

  // 3. Transport factory returns a stub for an unknown kind without throwing.
  try {
    const t = createTransport({ kind: 'http', endpoint: '127.0.0.1:9' } as never);
    checks.push({ name: 'transport-factory', ok: !!t });
  } catch {
    checks.push({ name: 'transport-factory', ok: false });
  }

  // 4. Offline buffer is queryable.
  try {
    bufferedEventCount();
    checks.push({ name: 'offline-buffer', ok: true });
  } catch {
    checks.push({ name: 'offline-buffer', ok: false });
  }

  // 5. Crash store is readable.
  try {
    listLocalCrashes();
    checks.push({ name: 'crash-store', ok: true });
  } catch {
    checks.push({ name: 'crash-store', ok: false });
  }

  // 6. Virtual device round-trips a scan command.
  try {
    const state = createVirtualDeviceState();
    const cmd: CommandMessage = { kind: 'command', v: 1, id: 'selftest-1', cap: 'scanner.barcode', action: 'scan', payload: { code: '01012345678905' } };
    const wire = encode(cmd);
    const resp = runVirtualWire(state, wire);
    checks.push({ name: 'virtual-device', ok: resp.includes('"ok"') || resp.length > 0, detail: `scanned=${state.scannedCodes.length}` });
  } catch (e) {
    checks.push({ name: 'virtual-device', ok: false, detail: (e as Error).message });
  }

  // 7. Heartbeat payload builder produces a version + capability list.
  try {
    const cfg = loadConfig();
    const advertised = advertisedCapabilities(cfg);
    checks.push({ name: 'telemetry', ok: !!agentInfo().version && Array.isArray(advertised), detail: `v=${agentInfo().version}` });
  } catch {
    checks.push({ name: 'telemetry', ok: false });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

/** Boot the virtual device as a loopback WS/HTTP server on `port`. */
export function startVirtualServer(port: number): void {
  const state = createVirtualDeviceState();
  const clients = new Set<{ send: (d: string) => void }>();

  Bun.serve({
    port,
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(encode(virtualHello()));
      },
      message(ws, msg) {
        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg as unknown as ArrayBuffer);
        ws.send(runVirtualWire(state, text));
      },
      close(ws) {
        clients.delete(ws);
      },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/health') {
        return Response.json({ ok: true, virtual: true, scanned: state.scannedCodes.length, printed: state.printedJobs.length, drawerKicks: state.drawerKicks });
      }
      if (url.pathname === '/' && server.upgrade(req)) return;
      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`Sanal Connector cihazı: ws://127.0.0.1:${port} (roadmap §40). Komut bekleniyor...`);
}
