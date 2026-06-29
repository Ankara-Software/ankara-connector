#!/usr/bin/env bun
// Ankara Yazılım Connector — CLI entry.
//
// Default (no args): start the agent — opens web auth if not yet paired.
//   ankara-connector
//   ankara-connector run
//
// Optional maintenance (hidden from end-user docs):
//   ankara-connector status
//   ankara-connector logout
//   ankara-connector version

import { loadConfig, saveConfig, defaultConfig } from './config';
import { runAgent } from './agent';
import { CONNECTOR_VERSION } from './version';
import { stageUpdateIfAvailable, tryApplyStoredUpdate } from './update';

const VERSION = CONNECTOR_VERSION;

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'run';

  switch (cmd) {
    case 'version':
    case '-v':
    case '--version':
      console.log(`ankara-connector ${VERSION}`);
      return;

    case 'status': {
      const cfg = loadConfig();
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }

    case 'logout': {
      const cfg = loadConfig();
      saveConfig({
        ...defaultConfig(),
        apiBase: cfg.apiBase,
        statusPort: cfg.statusPort,
        printer: cfg.printer,
      });
      console.log('Yerel oturum silindi. Connector’ı yeniden başlattığınızda tarayıcıda oturum açmanız istenecek.');
      return;
    }

    case 'run':
    case 'start':
      await tryApplyStoredUpdate();
      await runAgent();
      return;

    case 'update-check': {
      const cfg = loadConfig();
      const pending = await stageUpdateIfAvailable(cfg);
      if (!pending) console.log('Güncelleme yok veya indirilemedi.');
      return;
    }

    case 'help':
    case '-h':
    case '--help':
      console.log(`Ankara Yazılım Connector ${VERSION}

Kullanım:
  ankara-connector              Başlat (ilk seferde tarayıcıda oturum açma sayfası açılır)
  ankara-connector logout       Yerel oturumu sıfırla
  ankara-connector status       Yerel yapılandırmayı göster
  ankara-connector version      Sürümü göster
  ankara-connector update-check Güncelleme kontrolü (doğrulanmış indirme)

Oturum kalıcıdır — bir kez giriş yaptıktan sonra kim olduğunuzu ve hangi
firmaya bağlı olduğunuzu hatırlar. Tüm cihaz ayarları web panelden yapılır.
Güncellemeler SHA-256 doğrulaması sonrası yeniden başlatmada uygulanır.`);
      return;

    default:
      console.error(`Bilinmeyen komut: ${cmd}`);
      console.error('Kullanım: ankara-connector [--help]');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
