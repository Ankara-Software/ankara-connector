// ALPR camera driver (roadmap §13/28) — RTSP capture + edge OCR.
//
// Panel commands: { action: 'recognize', fps?, frames? } → captures frames via
// ffmpeg, runs OCR locally (tesseract.js when present), dedups plates, and
// returns parsed plate text only. Raw frames never leave the host (KVKK item
// 26). Also exposes a 'discover' action that uses ONVIF WS-Discovery to find
// cameras on the LAN (roadmap §20).

import { PlateDeduper } from '../alpr';
import { loadConfig } from '../config';
import type { ICapabilityDriver } from '../driver-host';
import { customerError } from '../errors';
import { captureAndOcr } from '../ocr';
import {
    ONVIF_MULTICAST,
    ONVIF_PORT,
    buildDiscoveryProbe,
    parseProbeMatch,
} from '../onvif';
import type { CommandMessage } from '../protocol';
import { createTransport } from '../transports/registry';

export const alprDriver: ICapabilityDriver = {
  id: 'rtsp-alpr',
  capability: 'alpr.camera',
  label: 'Plaka tanıma kamerası (RTSP + OCR)',
  isAvailable: () => !!loadConfig().camera,
  handle: async (cmd: CommandMessage) => {
    const cfg = loadConfig().camera;
    if (!cfg) return { error: customerError('not_configured') };
    const action = String(cmd.action || 'recognize');
    if (action !== 'recognize' && action !== 'capture' && action !== 'ocr') {
      return { error: customerError('unsupported_action', `alpr.camera.${action}`) };
    }
    const p = (cmd.payload ?? {}) as { fps?: number; frames?: number };
    try {
      const result = await captureAndOcr(cfg.rtspUrl, Number(p.fps ?? 1), Number(p.frames ?? 3));
      if (result.frameCount === 0) {
        return { error: customerError('camera_error', 'Kameradan kare alınamadı (ffmpeg/akış?).') };
      }
      const dedup = new PlateDeduper(5000);
      const plates = result.plates.filter((pl) => dedup.accept(pl.plate));
      if (plates.length === 0 && result.plates.length === 0) {
        return { error: customerError('ocr_error', 'Plaka tanınamadı.') };
      }
      return { payload: { plates, frameCount: result.frameCount } };
    } catch (e) {
      return { error: customerError('camera_error', (e as Error).message) };
    }
  },
  async discover() {
    // ONVIF WS-Discovery over UDP multicast.
    const t = createTransport({
      kind: 'udp',
      endpoint: `${ONVIF_MULTICAST}:${ONVIF_PORT}`,
    });
    const opened = await t.open();
    if (!opened) {
      await t.close();
      return [];
    }
    try {
      const probe = buildDiscoveryProbe(cryptoUuid());
      // UdpTransport.write sends to the default remote (the multicast addr).
      await t.write(new TextEncoder().encode(probe));
      const found: { id: string; label: string; capability: 'camera.onvif'; address: { kind: 'udp'; endpoint: string } }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const buf = await t.read(800);
        if (!buf) continue;
        const xml = new TextDecoder().decode(buf);
        const { xaddrs } = parseProbeMatch(xml);
        for (const x of xaddrs) {
          found.push({ id: x, label: 'ONVIF kamera', capability: 'camera.onvif', address: { kind: 'udp', endpoint: x } });
        }
      }
      return found;
    } finally {
      await t.close();
    }
  },
};

function cryptoUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
