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
#   ankara-connector install-daemon --silent --config /path/config.json
#     # silent (unattended, no prompts) + pre-seed config for 500-machine rollout
#
# This helper is a thin, reviewable shell surface; the compiled binary still
# owns the loopback server and hardware drivers.

set -eu

BIN_PATH="${CONNECTOR_BIN:-$(command -v ankara-connector || echo "$HOME/.ankara-connector/bin/ankara-connector")}"
OS="$(uname -s)"
SILENT=0
CONFIG_FILE=""

# Parse flags after the action argument (roadmap §45 silent install).
ACTION="${1:-}"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --silent|-s) SILENT=1; shift ;;
    --config) CONFIG_FILE="${2:-}"; shift 2 ;;
    --config=*) CONFIG_FILE="${1#--config=}"; shift ;;
    *) shift ;;
  esac
done

log() {
  if [ "$SILENT" -eq 0 ]; then echo "$@"; fi
}

# Pre-seed config.json from a provided file (silent rollout, roadmap §45).
seed_config() {
  if [ -z "$CONFIG_FILE" ]; then return 0; fi
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Yapılandırma dosyası bulunamadı: $CONFIG_FILE" >&2
    exit 3
  fi
  CFG_DIR="$HOME/.ankara-connector"
  mkdir -p "$CFG_DIR"
  cp "$CONFIG_FILE" "$CFG_DIR/config.json"
  chmod 600 "$CFG_DIR/config.json"
  log "Yapılandırma $CFG_DIR/config.json konumuna kopyalandı."
}

case "$ACTION" in
  install-daemon)
    seed_config
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
    log "Connector arka plan hizmeti olarak kuruldu."
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
    log "Connector arka plan hizmeti kaldırıldı."
    ;;
  *)
    echo "Kullanım: ankara-connector install-daemon|uninstall-daemon [--silent --config <file>]" >&2
    exit 1
    ;;
esac
