import { describe, expect, test } from 'bun:test';

import { buildCaptureArgs, buildRtspRequest, parseRtspStatus, parseSdpTracks } from './rtsp';

describe('rtsp', () => {
  test('buildRtspRequest DESCRIBE includes CSeq + Accept sdp', () => {
    const r = buildRtspRequest('DESCRIBE', { url: 'rtsp://1.2.3.4/stream' });
    expect(r.startsWith('DESCRIBE rtsp://1.2.3.4/stream RTSP/1.0')).toBe(true);
    expect(r).toContain('CSeq: 1');
    expect(r).toContain('Accept: application/sdp');
  });

  test('buildRtspRequest SETUP includes Transport', () => {
    const r = buildRtspRequest('SETUP', { url: 'rtsp://1.2.3.4/track1', cseq: 2 });
    expect(r).toContain('Transport: RTP/AVP;unicast;client_port=8000-8001');
    expect(r).toContain('CSeq: 2');
  });

  test('buildRtspRequest PLAY includes Session + Range', () => {
    const r = buildRtspRequest('PLAY', { url: 'rtsp://1.2.3.4/stream' });
    expect(r).toContain('Session: 12345678');
    expect(r).toContain('Range: npt=0.000-');
  });

  test('parseRtspStatus parses status line', () => {
    expect(parseRtspStatus('RTSP/1.0 200 OK')).toEqual({ version: 'RTSP/1.0', status: 200, reason: 'OK' });
    expect(parseRtspStatus('not rtsp')).toBeNull();
  });

  test('parseSdpTracks extracts control track ids', () => {
    const sdp = [
      'v=0',
      'm=video 0 RTP/AVP 96',
      'a=control:trackID=1',
      'm=audio 0 RTP/AVP 0',
      'a=control:trackID=2',
    ].join('\n');
    const tracks = parseSdpTracks(sdp);
    expect(tracks.length).toBe(2);
    expect(tracks[0].trackId).toBe('trackID=1');
    expect(tracks[0].type).toBe('video');
  });

  test('buildCaptureArgs uses tcp transport + fps filter', () => {
    const args = buildCaptureArgs('rtsp://x', '/tmp/frames', 2);
    expect(args).toContain('-rtsp_transport');
    expect(args).toContain('tcp');
    expect(args).toContain('fps=2');
  });
});
