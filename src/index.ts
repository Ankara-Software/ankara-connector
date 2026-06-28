#!/usr/bin/env bun
// Ankara Yazılım Bağlayıcı — CLI entry.
//
//   ankara-connector pair <kod> [--api https://...] [--label "Kasa 1"]
//   ankara-connector run
//   ankara-connector status
//   ankara-connector printer <host[:port]> [--codepage 0]
//   ankara-connector version

import { loadConfig, saveConfig, type PrinterConfig } from './config';
import { pairDevice, agentInfo, advertisedCapabilities } from './pair';
import { runAgent } from './agent';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help';
  const cfg = loadConfig();

  switch (cmd) {
    case 'version':
      console.log('ankara-connector 1.0.0');
      return;

    case 'pair': {
      const code = process.argv[3];
      if (!code) {
        console.error('Kullanım: ankara-connector pair <kod> [--api URL] [--label AD]');
        process.exit(1);
      }
      const apiBase = arg('--api') ?? cfg.apiBase;
      const label = arg('--label');
      const info = agentInfo();
      const caps = advertisedCapabilities({ ...cfg, printer: cfg.printer });
      const r = await pairDevice({ apiBase, code, agent: info, capabilities: caps, label: label ?? undefined });
      if (!r.ok) {
        console.error(r.error);
        process.exit(1);
      }
      const next = { ...cfg, apiBase, token: r.token, deviceId: r.deviceId, label: label ?? cfg.label };
      saveConfig(next);
      console.log(`Eşleştirme başarılı. Cihaz kimliği: ${r.deviceId}`);
      console.log('Belirteç güvenli şekilde kaydedildi. Şimdi `ankara-connector run` çalıştırın.');
      return;
    }

    case 'printer': {
      const target = process.argv[3];
      if (!target) {
        console.error('Kullanım: ankara-connector printer <host[:port]> [--codepage 0]');
        process.exit(1);
      }
      const [host, portStr] = target.split(':');
      const port = Number(portStr ?? '9100');
      const codePage = Number(arg('--codepage') ?? '0');
      const printer: PrinterConfig = { host, port, codePage };
      saveConfig({ ...cfg, printer });
      console.log(`Yazıcı kaydedildi: ${host}:${port} (codePage ${codePage})`);
      return;
    }

    case 'status': {
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }

    case 'run': {
      await runAgent();
      return;
    }

    default:
      console.log(`Ankara Yazılım Bağlayıcı

Kullanım:
  ankara-connector pair <kod> [--api URL] [--label AD]   Cihazı panele eşleştir
  ankara-connector run                                    Arka planda çalıştır
  ankara-connector status                                 Yapılandırmayı göster
  ankara-connector printer <host[:port]> [--codepage N]   Ağ yazıcısı tanıt
  ankara-connector version                                Sürümü göster`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
