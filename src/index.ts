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

import { spawn } from 'node:child_process';
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
      const silent = process.argv.includes('--silent') || process.argv.includes('/S');
      const configIdx = process.argv.indexOf('--config');
      const configFile = configIdx >= 0 ? process.argv[configIdx + 1] : undefined;
      const isWin = process.platform === 'win32';
      const script = isWin
        ? require('node:path').join(process.cwd(), 'scripts', 'install-daemon-windows.ps1')
        : require('node:path').join(process.cwd(), 'scripts', 'install-daemon.sh');
      const action = cmd === 'install-daemon' ? 'install' : 'uninstall';
      if (isWin) {
        const psArgs = ['-File', script, '-Action', action];
        if (silent) psArgs.push('-Silent');
        if (configFile) psArgs.push('-Config', configFile);
        spawn('pwsh', psArgs, { stdio: 'inherit' });
      } else {
        const shArgs: string[] = [cmd];
        if (silent) shArgs.push('--silent');
        if (configFile) shArgs.push('--config', configFile);
        spawn('/bin/sh', [script, ...shArgs], { stdio: silent ? 'ignore' : 'inherit' });
      }
      return;
    }

    case 'watchdog': {
      const { runWatchdog } = await import('./watchdog');
      await runWatchdog({ argv: ['run'] });
      return;
    }

    case 'update-check': {
      const cfg = loadConfig();
      const pending = await stageUpdateIfAvailable(cfg);
      if (!pending) console.log('Güncelleme yok veya indirilemedi.');
      return;
    }

    case 'trust-cert': {
      const { loadOrGenerateCert, trustLocalhostCert } = await import('./tls-cert');
      console.log(
        'Panelin bu bilgisayardaki yazıcı ve cihazlara güvenli bağlanması için yerel sertifika gerekir.',
      );
      const cert = loadOrGenerateCert();
      if (!cert) {
        console.error('Sertifika üretilemedi (openssl kurulu mu?).');
        process.exit(3);
      }
      const installed = trustLocalhostCert();
      console.log(`Yerel sertifika: ${cert.certPath}`);
      if (installed) {
        console.log('Sertifika işletim sistemi güven deposuna eklendi. Tarayıcı uyarısı olmaksızın wss:// kullanılabilir.');
      } else {
        console.log('Otomatik güven eklenemedi. Windows güvenlik uyarısında Evet deyin veya README.txt adımlarını izleyin.');
      }
      return;
    }

    case 'selftest': {
      const { runSelftest } = await import('./selftest');
      const result = await runSelftest();
      for (const c of result.checks) {
        console.log(`${c.ok ? 'OK ' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      }
      console.log(result.ok ? 'selftest: GEÇTİ' : 'selftest: BAŞARISIZ');
      process.exit(result.ok ? 0 : 1);
    }

    case '--virtual':
    case 'virtual': {
      const { startVirtualServer } = await import('./selftest');
      const port = Number(process.argv[3] ?? 4782);
      startVirtualServer(port);
      await new Promise(() => {});
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
  ankara-connector install-daemon --silent  Sessiz kurulum (katılımsız dağıtım)
  ankara-connector uninstall-daemon Arka plan hizmetini kaldır
  ankara-connector watchdog        Agent’ı denetle, çökünce yeniden başlat
  ankara-connector selftest        Donanım olmadan iç test (destek/QA)
  ankara-connector --virtual [port] Sanal cihaz sunucusu başlat (test)

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
