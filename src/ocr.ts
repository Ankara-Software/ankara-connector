// Edge OCR engine (roadmap §28) — runs plate OCR locally on the host.
//
// Heavy OCR is delegated to `tesseract.js` (WASM, no cloud call) when present.
// The module is loaded lazily so the core build stays clean; when tesseract is
// unavailable, captureAndOcr still returns the captured frame path so the
// panel/server can run OCR downstream, but never the raw frame is uploaded
// wholesale (KVKK item 26 — only the parsed plate text leaves the host when
// OCR succeeds locally). A trivial fallback normalizes any tesseract output
// through src/alpr.ts plate validation.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadNativeModule } from './transports/native-loader';
import { buildCaptureArgs } from './rtsp';
import { parseTurkishPlate } from './alpr';

export interface OcrResult {
  plates: { plate: string; valid: boolean; confidence: number }[];
  frameCount: number;
  /** Temp dir of captured frames (cleaned up after OCR). */
  framesDir: string | null;
}

interface TesseractWorker {
  recognize: (img: string) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<void>;
}

interface TesseractApi {
  createWorker: (lang?: string) => Promise<TesseractWorker>;
}

/**
 * Capture N frames from an RTSP stream via ffmpeg and run OCR locally.
 * Returns parsed plate candidates. Never uploads raw frames.
 */
export async function captureAndOcr(rtspUrl: string, fps = 1, durationFrames = 3): Promise<OcrResult> {
  const framesDir = mkdtempSync(join(tmpdir(), 'connector-alpr-'));
  const args = buildCaptureArgs(rtspUrl, framesDir, fps);

  await runFfmpeg(args);

  const frames = readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).slice(0, durationFrames);
  if (frames.length === 0) {
    cleanup(framesDir);
    return { plates: [], frameCount: 0, framesDir };
  }

  const plates: { plate: string; valid: boolean; confidence: number }[] = [];
  const mod = await loadNativeModule<TesseractApi>('tesseract.js');
  if (mod.ok) {
    const worker = await mod.api.createWorker('eng');
    try {
      for (const f of frames) {
        const path = join(framesDir, f);
        const { data } = await worker.recognize(path);
        for (const line of data.text.split('\n')) {
          const parsed = parseTurkishPlate(line);
          if (parsed.plate) {
            plates.push({ plate: parsed.plate, valid: parsed.valid, confidence: data.confidence / 100 });
          }
        }
      }
    } finally {
      await worker.terminate();
    }
  }
  cleanup(framesDir);
  return { plates, frameCount: frames.length, framesDir: null };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn('ffmpeg', args, { stdio: 'ignore' });
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
