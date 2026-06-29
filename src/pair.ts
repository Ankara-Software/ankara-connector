// Pairing + token rotation client. Talks to the existing server endpoints:
//   POST {apiBase}/connector/pair    { code, agent:{name,version,os,capabilities} }
//   POST {apiBase}/connector/rotate  Authorization: Bearer <token>
// Both return { success, data:{ deviceId, token } } on success.

import type { ConnectorConfig } from './config';
import type { Capability, AgentInfo } from './protocol';

interface PairResponse {
  success?: boolean;
  data?: { deviceId?: string; token?: string };
  error?: { message?: string };
  message?: string;
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<PairResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as PairResponse | null;
  return json ?? { success: false, error: { message: `Sunucu hatası (${res.status})` } };
}

export interface PairArgs {
  apiBase: string;
  code: string;
  agent: AgentInfo;
  capabilities: readonly Capability[];
  label?: string;
}

export async function pairDevice(args: PairArgs): Promise<{ ok: true; deviceId: string; token: string } | { ok: false; error: string }> {
  const base = args.apiBase.replace(/\/$/, '');
  const json = await postJson(`${base}/connector/pair`, {
    code: args.code,
    agent: { name: args.agent.name, version: args.agent.version, os: args.agent.os },
    capabilities: args.capabilities,
  });
  if (!json.success || !json.data?.token || !json.data?.deviceId) {
    return { ok: false, error: json.error?.message || json.message || 'Eşleştirme başarısız.' };
  }
  return { ok: true, deviceId: json.data.deviceId, token: json.data.token };
}

export async function rotateToken(apiBase: string, token: string): Promise<{ ok: true; deviceId: string; token: string } | { ok: false; error: string }> {
  const base = apiBase.replace(/\/$/, '');
  const json = await postJson(`${base}/connector/rotate`, {}, token);
  if (!json.success || !json.data?.token || !json.data?.deviceId) {
    return { ok: false, error: json.error?.message || json.message || 'Belirteç yenilenemedi.' };
  }
  return { ok: true, deviceId: json.data.deviceId, token: json.data.token };
}

export function agentInfo(): AgentInfo {
  const platform = (process.platform || '').toLowerCase();
  const os: AgentInfo['os'] = platform.startsWith('win')
    ? 'windows'
    : platform.startsWith('darwin')
      ? 'macos'
      : 'linux';
  return { name: 'ankara-connector', version: '1.1.0', os };
}

export function advertisedCapabilities(cfg: ConnectorConfig): Capability[] {
  const caps: Capability[] = ['scanner.barcode', 'scanner.qr', 'uyap.bridge'];
  if (cfg.printer) {
    caps.push('printer.escpos', 'printer.label', 'drawer.kick');
  }
  return caps;
}
