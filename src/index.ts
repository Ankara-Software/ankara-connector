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

import { runAgent } from './agent';
import { defaultConfig, loadConfig, saveConfig } from './config';
import { stageUpdateIfAvailable, tryApplyStoredUpdate } from './update';
import { CONNECTOR_VERSION } from './version';

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

    case 'install-daemon':
    case 'uninstall-daemon': {
      const { spawn } = await import('node:child_process');
      const isWin = process.platform === 'win32';
      const script = isWin
        ? require('node:path').join(process.cwd(), 'scripts', 'install-daemon-windows.ps1')
        : require('node:path').join(process.cwd(), 'scripts', 'install-daemon.sh');
      const action = cmd === 'install-daemon' ? 'install' : 'uninstall';
      if (isWin) {
        spawn('pwsh', ['-File', script, '-Action', action], { stdio: 'inherit' });
      } else {
        spawn('/bin/sh', [script, cmd], { stdio: 'inherit' });
      }
      return;
    }

    case 'update-check': {
      const cfg = loadConfig();
      const pending = await stageUpdateIfAvailable(cfg);
      if (!pending) console.log('Güncelleme yok veya indirilemedi.');
      return;
    }

    case 'trust-cert': {
      const { loadOrGenerateCert, writeTrustReadme } = await import('./tls-cert');
      const cert = loadOrGenerateCert();
      if (!cert) {
        console.error('Sertifika üretilemedi (openssl kurulu mu?).');
        process.exit(3);
      }
      writeTrustReadme();
      console.log(`Yerel sertifika: ${cert.certPath}`);
      console.log('Tarayıcı güveni için README.txt içindeki adımları izleyin.');
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
  ankara-connector install-daemon   Arka plan hizmeti olarak kur (açılışta başlasın)
  ankara-connector uninstall-daemon Arka plan hizmetini kaldır

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
