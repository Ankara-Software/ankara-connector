# Ankara Yazılım Bağlayıcı (Connector)

Ankara Yazılım panellerini fiziksel donanımla köprüleyen, arka planda çalışan
**başsız (headless)** agent. Windows, macOS ve Linux için tek dosyalık çalıştırılabilir
ikili olarak dağıtılır; kurulum sonrası tüm yönetim web panelden yapılır.

> Durum: **v1.0.0 ön sürüm**. Termal fiş yazıcı (ESC/POS, ağ yazıcısı), barkod/QR
> olayları ve cihaz eşleştirme canlı. Nitelikli e-imza (NES), ödeme cihazı, biyometrik
> ve mobil (Android/iOS) derlemeleri **yakında** (operatör/SDK bağımlı).

## Ne yapar

- **Cihaz eşleştirme** — panelde üretilen tek kullanımlık kod ile cihazı firmanıza
  bağlar; belirteç yerelde güvenli saklanır ve otomatik yenilenir.
- **Termal fiş yazıcı** — ESC/POS komutlarını ağ yazıcısına (port 9100) ham TCP ile
  gönderir. Başlık, satırlar, hizalama, kalın/çift boy, kağıt kesme.
- **Etiket/barkod yazıcı** — aynı ESC/POS kanalı üzerinden etiket basımı.
- **Para çekmecesi** — yazıcı üzerinden çekmeze pulse gönderir.
- **Barkod/QR olayları** — tarayıcıdan gelen kodları panele olay olarak iletir.
- **Yerel durum sunucusu** — `http://127.0.0.1:4781` üzerinde minimal durum sayfası
  ve `ws://127.0.0.1:4781` üzerinde panelin komut gönderdiği loopback WebSocket.

## Mimari

Panel, aynı makineden `ws://127.0.0.1:{port}` adresine bağlanır ve
[`@ankara/connector-protocol`](https://github.com/Ankara-Software) ile tanımlı
`CommandMessage` gönderir. Agent komutu çalıştırır (ör. fiş yazdır) ve `AckMessage`
döner. Cihaz donanımı yerelde kalır; hiçbir ham donanım trafiği sunucudan geçmez.

```
[ Web paneli ] --ws loopback--> [ Connector agent ] --TCP/9100--> [ Termal yazıcı ]
        |                              |
        |  (pair/rotate over HTTPS)    +---> api.ankarayazilim.org
```

## Kurulum

1. Sürümden platformunuza uygun ikiliyi indirin (bkz. Releases).
2. (Windows) SmartScreen uyarısı çıkarsa “Daha fazla bilgi → Yine de çalıştır”
   deyin; imzalı sürümde uyarı çıkmaz.
3. (macOS) `chmod +x` sonrası “Geliştirici doğrulanamadı” uyarısında
   Sistem Ayarları → Gizlilik ve Güvenlik → “Yine de Aç”.
4. Panelde **Firma Yönetimi → Cihaz Bağlayıcı** → “Cihaz bağla” ile tek kullanımlık
   kod alın.
5. Terminalde: `ankara-connector pair <kod> --label "Kasa 1"`
6. Yazıcı tanıtın: `ankara-connector printer 192.168.1.50:9100`
7. Çalıştırın: `ankara-connector run` (arka planda/servis olarak)

## CLI

```
ankara-connector pair <kod> [--api URL] [--label AD]   Cihazı panele eşleştir
ankara-connector run                                    Arka planda çalıştır
ankara-connector status                                 Yapılandırmayı göster
ankara-connector printer <host[:port]> [--codepage N]   Ağ yazıcısı tanıt
ankara-connector version                                Sürümü göster
```

Yapılandırma: `~/.ankara-connector/config.json` (yerel, 0600).

## Geliştirme

```
bun install
bun run src/index.ts run          # doğrudan çalıştır
bun run scripts/build.ts          # tüm desktop hedeflerini dist/'e derle
```

Derleme hedefleri (Bun `--compile`):
- `bun-windows-x64` → `.exe`
- `bun-darwin-x64`, `bun-darwin-arm64`
- `bun-linux-x64`

## Sürümleme

`git tag v*` push → `release.yml` workflow’u matrix (windows/macos-arm64/macos-x64/linux)
üzerinde derler ve GitHub Release’e ikili + `sha256sums.txt` olarak yükler.

## Lisans

MIT — Ankara Yazılım.
