# Ankara Yazılım Connector



Ankara Yazılım panellerini fiziksel donanımla köprüleyen arka plan agent'ı.



> **v2.0.0** — Tek Rust binary (`AnkaraConnector.exe`), cloud WSS relay (`api.ankarayazilim.org`),

> native tray (Hakkında, oturum aç/kapat). Localhost TLS / port 4781 loopback kaldırıldı.



## Mimari (v2)



```

Panel → HTTPS → api.ankarayazilim.org (/v1/connector/command)

Agent → WSS outbound → api.ankarayazilim.org (/v1/connector/agent)

Agent → ESC/POS / drawer / scanner → yerel donanım

```



Oturum açma: tray **Oturum aç** → tarayıcı `/connector/baglan` → agent `pair-result` poll.



## Rust workspace



```

crates/

  connector-app/       # AnkaraConnector.exe (main)

  connector-cloud/     # WSS, heartbeat, web-pair poll

  connector-tray/      # systray + native About (Windows MessageBox)

  connector-drivers/   # printer.escpos, drawer.kick, scanner.*

  connector-config/    # ~/.ankara-connector + OS keyring

  connector-protocol/  # wire messages

```



## Derleme



**Windows (s18 CI veya MSVC ortamı):**



```bash

bun run build:windows    # cargo release + NSIS installer

```



**Geliştirme:**



```bash

cargo build -p connector-app

cargo test

```



> Git Bash'te GNU `link.exe` MSVC ile çakışabilir — Windows'ta `cmd` veya Visual Studio

> Developer Prompt kullanın; CI s18'de Rust toolchain kurulu.



## v1 emeklilik



`ankara-connector-core.exe` (Bun) + `AnkaraYazilimConnector.exe` (Go tray) v2.0.0 ile

Windows dağıtımından kaldırıldı. macOS/Linux geçici olarak Bun 2.0.0 ikilileri; Rust shell

sonrası tek binary olacak.



Eski kaynak: `src/` (Bun agent, arşiv).



## Lisans



MIT — Ankara Yazılım.

