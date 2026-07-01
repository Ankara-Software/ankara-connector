import { describe, expect, test } from 'bun:test';

import { buildDiscoveryProbe, buildGetDeviceInformation, parseCapabilitiesRtspUri, parseProbeMatch } from './onvif';

describe('onvif', () => {
  test('buildDiscoveryProbe targets NetworkVideoTransmitter', () => {
    const xml = buildDiscoveryProbe('abc-123');
    expect(xml).toContain('urn:uuid:abc-123');
    expect(xml).toContain('NetworkVideoTransmitter');
    expect(xml).toContain('Probe');
  });

  test('buildGetDeviceInformation wraps SOAP action', () => {
    const xml = buildGetDeviceDeviceInformationCase('abc', 'http://1.2.3.4/onvif/device_service');
    expect(xml).toContain('GetDeviceInformation');
    expect(xml).toContain('http://1.2.3.4/onvif/device_service');
  });

  test('parseProbeMatch extracts XAddrs + types', () => {
    const xml = `<env:Body><ProbeMatches><ProbeMatch><XAddrs>http://192.168.1.64/onvif/device_service http://192.168.1.65/onvif/device_service</XAddrs><Types>dn:NetworkVideoTransmitter</Types></ProbeMatch></ProbeMatches>`;
    const r = parseProbeMatch(xml);
    expect(r.xaddrs.length).toBe(2);
    expect(r.xaddrs[0]).toBe('http://192.168.1.64/onvif/device_service');
    expect(r.types).toContain('dn:NetworkVideoTransmitter');
  });

  test('parseCapabilitiesRtspUri finds RTSP URI', () => {
    const xml = `<tds:Capabilities><tt:RtspStreamingUri>rtsp://192.168.1.64/stream1</tt:RtspStreamingUri></tds:Capabilities>`;
    expect(parseCapabilitiesRtspUri(xml)).toBe('rtsp://192.168.1.64/stream1');
  });
});

// helper to keep the test above self-contained
function buildGetDeviceDeviceInformationCase(uuid: string, to: string): string {
  return buildGetDeviceInformation(uuid, to);
}
