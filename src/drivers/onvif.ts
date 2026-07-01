// ONVIF camera driver (roadmap §20) — device discovery + service calls.
//
// Exposes `camera.onvif` for general IP cameras/NVRs (vs alpr.camera which is
// plate-specific). Panel commands: { action: 'discover' | 'info' } → runs
// WS-Discovery over UDP multicast, or GetDeviceInformation over HTTP/SOAP to a
// known camera URL. Uses the existing onvif.ts SOAP builders + fetch for the
// device service (no native addon).

import { customerError } from '../errors';
import type { ICapabilityDriver } from '../driver-host';
import {
  ONVIF_MULTICAST,
  ONVIF_PORT,
  buildDiscoveryProbe,
  buildGetDeviceInformation,
  parseProbeMatch,
} from '../onvif';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';

function cryptoUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const onvifDriver: ICapabilityDriver = {
  id: 'onvif-camera',
  capability: 'camera.onvif',
  label: 'IP kamera (ONVIF)',
  isAvailable: () => true,
  handle: async (cmd: CommandMessage) => {
    const action = String(cmd.action || 'discover');
    if (action === 'discover') {
      const devices = await onvifDiscover();
      return { payload: { devices } };
    }
    if (action === 'info') {
      const p = (cmd.payload ?? {}) as { url?: string };
      if (!p.url) return { error: customerError('not_configured', 'ONVIF servis URL gerekli.') };
      const soap = buildGetDeviceInformation(cryptoUuid(), p.url);
      try {
        const res = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
          body: soap,
        });
        const xml = await res.text();
        return { payload: { xml: xml.slice(0, 4000), ok: res.ok } };
      } catch (e) {
        return { error: customerError('camera_error', (e as Error).message) };
      }
    }
    return { error: customerError('unsupported_action', `camera.onvif.${action}`) };
  },
  discover: onvifDiscover,
};

async function onvifDiscover() {
  const t = createTransport({ kind: 'udp', endpoint: `${ONVIF_MULTICAST}:${ONVIF_PORT}` });
  const opened = await t.open();
  if (!opened) {
    await t.close();
    return [];
  }
  try {
    const probe = buildDiscoveryProbe(cryptoUuid());
    await t.write(new TextEncoder().encode(probe));
    const found: { id: string; label: string; capability: 'camera.onvif'; address: { kind: 'http'; endpoint: string } }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const buf = await t.read(800);
      if (!buf) continue;
      const { xaddrs, types } = parseProbeMatch(new TextDecoder().decode(buf));
      for (const x of xaddrs) {
        found.push({ id: x, label: types.join(' ') || 'ONVIF cihazı', capability: 'camera.onvif', address: { kind: 'http', endpoint: x } });
      }
    }
    return found;
  } finally {
    await t.close();
  }
}
