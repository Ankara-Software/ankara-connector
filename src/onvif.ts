// ONVIF device discovery + service calls (roadmap §20).
//
// WS-Discovery probe over UDP multicast (239.255.255.250:3702) to find
// ONVIF cameras/NVRs on the LAN, plus SOAP request builders for the device
// service (GetCapabilities, GetDeviceInformation). Pure builders — the agent
// owns the UDP/TCP sockets.

export const ONVIF_MULTICAST = '239.255.255.250';
export const ONVIF_PORT = 3702;

/** Build the WS-Discovery Probe XML for ONVIF devices. */
export function buildDiscoveryProbe(uuid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>urn:uuid:${uuid}</a:MessageID>
    <a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
    <a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>`;
}

/** Build a SOAP envelope for an ONVIF device-service request. */
export function buildDeviceRequest(action: string, body: string, uuid: string, to: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">${action}</a:Action>
    <a:MessageID>urn:uuid:${uuid}</a:MessageID>
    <a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
    <a:To s:mustUnderstand="1">${to}</a:To>
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

export function buildGetCapabilities(uuid: string, to: string): string {
  return buildDeviceRequest('http://www.onvif.org/ver10/device/wsdl/GetCapabilities', '<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>All</tds:Category></tds:GetCapabilities>', uuid, to);
}

export function buildGetDeviceInformation(uuid: string, to: string): string {
  return buildDeviceRequest('http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation', '<tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>', uuid, to);
}

/** Extract device XAddrs (service URLs) from a WS-Discovery ProbeMatch. */
export function parseProbeMatch(xml: string): { xaddrs: string[]; types: string[] } {
  const xaddrs: string[] = [];
  const types: string[] = [];
  const xaddrMatch = xml.match(/<(?:\w+:)?XAddrs>([^<]+)<\/(?:\w+:)?XAddrs>/);
  if (xaddrMatch?.[1]) {
    xaddrs.push(...xaddrMatch[1].trim().split(/\s+/));
  }
  const typesMatch = xml.match(/<(?:\w+:)?Types>([^<]+)<\/(?:\w+:)?Types>/);
  if (typesMatch?.[1]) {
    types.push(...typesMatch[1].trim().split(/\s+/));
  }
  return { xaddrs, types };
}

/** Extract the RTSP streaming URI from a GetCapabilities response. */
export function parseCapabilitiesRtspUri(xml: string): string | null {
  const m = xml.match(/<tt:Rtsp([\w]+)>([^<]+)<\/tt:Rtsp\1>/) ?? xml.match(/Rtsp[^>]*>([^<]+)</);
  return m?.[2] ?? m?.[1] ?? null;
}
