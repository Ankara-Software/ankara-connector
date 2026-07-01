# Ankara Yazılım Connector

Ankara Yazılım panellerini fiziksel donanımla köprüleyen, arka planda çalışan
**headless** agent. Windows, macOS ve Linux için tek dosyalık çalıştırılabilir
ikili olarak dağıtılır; kurulum sonrası tüm yönetim web panelden yapılır.

> Durum: **v1.1.0**. Web oturum açma akışı, termal fiş yazıcı (ESC/POS), barkod/QR
> olayları ve cihaz yönetimi canlı. Nitelikli e-imza (NES), ödeme cihazı, biyometrik
> ve mobil (Android/iOS) derlemeleri **yakında** (operatör/SDK bağımlı).

## Ne yapar

- **Web oturum açma** — uygulamayı çalıştırınca tarayıcıda Ankara Yazılım oturum
  açma sayfası açılır; bir kez giriş yapınca oturum kalıcı olarak hatırlanır.
- **Termal fiş yazıcı** — ESC/POS komutlarını ağ yazıcısına (port 9100) ham TCP ile
  gönderir.
- **Etiket/barkod yazıcı** — aynı ESC/POS kanalı üzerinden etiket basımı.
- **Para çekmecesi** — yazıcı üzerinden çekmece pulse gönderir.
- **Barkod/QR olayları** — tarayıcıdan gelen kodları panele olay olarak iletir.
- **Yerel durum sunucusu** — `http://127.0.0.1:4781` üzerinde minimal durum sayfası
  ve `ws://127.0.0.1:4781` üzerinde panelin komut gönderdiği loopback WebSocket.

## Kurulum (son kullanıcı)

1. [Releases](https://github.com/Ankara-Software/ankara-connector/releases) sayfasından
   platformunuza uygun ikiliyi indirin.
2. İkiliyi çalıştırın (Windows `.exe`, macOS arm64/x64, Linux x64).
3. Tarayıcıda açılan **Connector oturum aç** sayfasında Ankara Yazılım hesabınızla
   giriş yapın ve **Bu bilgisayarı bağla** deyin.
4. Oturum kalıcıdır — Connector kim olduğunuzu ve hangi firmaya bağlı olduğunuzu
   hatırlar. Cihaz ayarlarını web panelden yönetin.

Terminal veya eşleştirme kodu gerekmez.

## CLI (bakım)

```
ankara-connector              Başlat (varsayılan)
ankara-connector logout       Yerel oturumu sıfırla
ankara-connector status       Yapılandırmayı göster
ankara-connector version      Sürümü göster
ankara-connector install-daemon [--silent]   Arka plan hizmeti olarak kur
ankara-connector uninstall-daemon            Arka plan hizmetini kaldır
ankara-connector watchdog      Agent’ı denetle, çökünce yeniden başlat
ankara-connector trust-cert    Yerel TLS sertifikası üret + güven rehberi
ankara-connector update-check  Doğrulanmış güncelleme kontrolü
```

Yapılandırma: `~/.ankara-connector/config.json` (yerel, 0600). Cihaz belirteci
OS anahtarlığında (macOS Keychain / Windows Credential Manager / dosya) saklanır.

## Operatör-bağımlı (blocked) yetenekler

Aşağıdaki yeteneklerin agent tarafı sözleşmeleri + mock sağlayıcıları hazırdır;
gerçek donanım/SDK operatör unblock’unu bekler:

- **Nitelikli e-imza (NES, PKCS#11)** — `src/esign.ts` (`EsignProvider`).
  Akis/e-Tuğra PKCS#11 kütüphanesi + kart sağlanması gerekiyor.
- **ÖKC / Ödeme cihazı** — `src/payment-device.ts` (`PaymentDeviceProvider`).
  GİB onaylı vendor SDK + banka kimlik bilgileri gerekiyor.
- **Biyometrik (parmak izi/iris)** — `src/biometric.ts` (`BiometricProvider`).
  ZKTeco/Suprema SDK lisansı gerekiyor.
- **EV code signing + MSI/PKG/deb + Android/iOS store** — p298-connector-code-signing
  ve p298-connector-mobile ile operatör takip ediliyor.

## Geliştirme

```
bun install
bun run src/index.ts            # doğrudan çalıştır
bun run scripts/build.ts        # tüm desktop hedeflerini dist/'e derle
bun test
```

## Sürümleme

`git tag v*` push → `release.yml` on s31 (cross-compile windows/macos-arm64/macos-x64/linux)
üzerinde derler ve GitHub Release'e ikili + `sha256sums.txt` olarak yükler.

## Lisans

MIT — Ankara Yazılım.
