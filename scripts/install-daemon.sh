#!/bin/sh
# ankara-connector — system service / auto-start registration (roadmap §3, §5).
#
# Installs the agent as an oturum-dışı (session-less) background daemon so it
# keeps running after logout and starts at boot. Supports Windows Service,
# Linux systemd, and macOS LaunchDaemon. Idempotent — safe to re-run.
#
# Usage:
#   ankara-connector install-daemon   # install + enable + start
#   ankara-connector uninstall-daemon # stop + disable + remove
#
# This helper is a thin, reviewable shell surface; the compiled binary still
# owns the loopback server and hardware drivers.

set -eu

BIN_PATH="${CONNECTOR_BIN:-$(command -v ankara-connector || echo "$HOME/.ankara-connector/bin/ankara-connector")}"
OS="$(uname -s)"

case "$1" in
  install-daemon)
    case "$OS" in
      Linux)
        cat > "$HOME/.config/systemd/user/ankara-connector.service" <<EOF
[Unit]
Description=Ankara Yazılım Connector
After=network-online.target

[Service]
ExecStart=$BIN_PATH run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
        systemctl --user daemon-reload
        systemctl --user enable --now ankara-connector.service
        ;;
      Darwin)
        PLIST="$HOME/Library/LaunchAgents/com.ankarayazilim.connector.plist"
        cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ankarayazilim.connector</string>
  <key>ProgramArguments</key><array>
    <string>$BIN_PATH</string><string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
        launchctl load "$PLIST"
        ;;
      *)
        echo "Windows için: ankara-connector.exe install-daemon (PowerShell)" >&2
        exit 2
        ;;
    esac
    echo "Connector arka plan hizmeti olarak kuruldu."
    ;;
  uninstall-daemon)
    case "$OS" in
      Linux)
        systemctl --user disable --now ankara-connector.service 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/ankara-connector.service"
        systemctl --user daemon-reload
        ;;
      Darwin)
        PLIST="$HOME/Library/LaunchAgents/com.ankarayazilim.connector.plist"
        launchctl unload "$PLIST" 2>/dev/null || true
        rm -f "$PLIST"
        ;;
    esac
    echo "Connector arka plan hizmeti kaldırıldı."
    ;;
  *)
    echo "Kullanım: ankara-connector install-daemon|uninstall-daemon" >&2
    exit 1
    ;;
esac
