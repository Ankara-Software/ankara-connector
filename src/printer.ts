// Raw TCP transport to a networked ESC/POS printer (port 9100 by convention).
// Uses node:net so it cross-compiles into the Bun binary without native addons.

import { createConnection } from 'node:net';
import type { PrintJob } from './escpos';
import { encodeJob } from './escpos';

export interface PrintResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export async function sendRawBytes(
  target: { host: string; port: number },
  data: Uint8Array,
  timeoutMs = 8000,
): Promise<PrintResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PrintResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // noop
      }
      resolve(r);
    };
    const socket = createConnection({ host: target.host, port: target.port }, () => {
      socket.write(Buffer.from(data), (err) => {
        if (err) {
          done({ ok: false, bytes: 0, error: err.message });
          return;
        }
        socket.end(() => {
          done({ ok: true, bytes: data.byteLength });
        });
      });
    });
    const timer = setTimeout(() => done({ ok: false, bytes: 0, error: 'Yazıcı zaman aşımı' }), timeoutMs);
    socket.on('error', (e: Error) => done({ ok: false, bytes: 0, error: e.message }));
  });
}

export async function printJob(
  target: { host: string; port: number },
  job: PrintJob,
  timeoutMs = 8000,
): Promise<PrintResult> {
  const data = encodeJob(job);
  return sendRawBytes(target, data, timeoutMs);
}
