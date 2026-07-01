// RTSP client (roadmap §13).
//
// Builds RTSP request lines for DESCRIBE / SETUP / PLAY / TEARDOWN and parses
// the SDP response to extract the video track. The actual RTP frame capture is
// delegated to a downstream ffmpeg/native pipeline (`captureFrames`); this
// module owns the control protocol so ALPR + ONVIF share one stream client.

export interface RtspOptions {
  url: string;
  /** Sequence number base (incremented per request). */
  cseq?: number;
  auth?: { user: string; pass: string };
}

/** Build a RTSP request string (DESCRIBE / SETUP / PLAY / TEARDOWN). */
export function buildRtspRequest(
  method: 'DESCRIBE' | 'OPTIONS' | 'SETUP' | 'PLAY' | 'TEARDOWN',
  opts: RtspOptions,
  extra: Record<string, string> = {},
): string {
  const cseq = opts.cseq ?? 1;
  const lines = [`${method} ${opts.url} RTSP/1.0`, `CSeq: ${cseq}`];
  if (opts.auth) {
    // Basic RTSP auth header placeholder — real digest handled at the socket layer.
    const cred = btoa(`${opts.auth.user}:${opts.auth.pass}`);
    lines.push(`Authorization: Basic ${cred}`);
  }
  if (method === 'DESCRIBE') lines.push('Accept: application/sdp');
  if (method === 'SETUP') lines.push('Transport: RTP/AVP;unicast;client_port=8000-8001');
  if (method === 'PLAY') lines.push('Session: 12345678', 'Range: npt=0.000-');
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${v}`);
  lines.push('', '');
  return lines.join('\r\n');
}

/** Parse an RTSP response status line -> { version, status, reason }. */
export function parseRtspStatus(line: string): { version: string; status: number; reason: string } | null {
  const m = line.match(/^(RTSP\/[\d.]+)\s+(\d{3})\s+(.*)$/);
  if (!m) return null;
  return { version: m[1], status: Number(m[2]), reason: m[3] };
}

/** Parse SDP body into track list (a=control attributes). */
export function parseSdpTracks(sdp: string): { trackId: string; type: string | null }[] {
  const tracks: { trackId: string; type: string | null }[] = [];
  let current: { trackId: string; type: string | null } | null = null;
  for (const line of sdp.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('m=')) {
      if (current) tracks.push(current);
      const type = trimmed.split(' ')[0]?.slice(2) ?? null;
      current = { trackId: '', type };
    } else if (trimmed.startsWith('a=control:')) {
      if (current) current.trackId = trimmed.slice('a=control:'.length);
    }
  }
  if (current) tracks.push(current);
  return tracks;
}

/** Build the ffmpeg frame-capture command for an RTSP stream (one frame per N ms). */
export function buildCaptureArgs(url: string, outDir: string, fps = 1): string[] {
  return [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-vf', `fps=${fps}`,
    '-q:v', '2',
    `${outDir}/frame_%05d.jpg`,
  ];
}
