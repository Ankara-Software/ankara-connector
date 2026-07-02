//! Local Connector configuration + secure token storage.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "ankara-connector";
const TOKEN_ACCOUNT: &str = "device-token";
const PAIR_STATE_TTL_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub code_page: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingUpdate {
    pub version: String,
    pub path: String,
    pub sha256: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsignConfig {
    #[serde(default)]
    pub pkcs11_lib: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorConfig {
    #[serde(default = "default_api_base", alias = "apiBase")]
    pub api_base: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, alias = "deviceId")]
    pub device_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "tenantName")]
    pub tenant_name: Option<String>,
    #[serde(default, alias = "pairedAt")]
    pub paired_at: Option<String>,
    #[serde(default)]
    pub printer: Option<PrinterConfig>,
    #[serde(default, alias = "pendingUpdate")]
    pub pending_update: Option<PendingUpdate>,
    #[serde(default)]
    pub esign: Option<EsignConfig>,
    #[serde(default, alias = "sessionPaused")]
    pub session_paused: bool,
    #[serde(default, alias = "pendingPairState")]
    pub pending_pair_state: Option<String>,
    #[serde(default, alias = "pendingPairStartedAt")]
    pub pending_pair_started_at: Option<String>,
    #[serde(default, alias = "lastPairAttemptAt")]
    pub last_pair_attempt_at: Option<String>,
}

fn default_api_base() -> String {
    "https://api.ankarayazilim.org/v1".to_string()
}

impl Default for ConnectorConfig {
    fn default() -> Self {
        Self {
            api_base: default_api_base(),
            token: None,
            device_id: None,
            label: Some("Connector".into()),
            tenant_name: None,
            paired_at: None,
            printer: None,
            pending_update: None,
            esign: None,
            session_paused: false,
            pending_pair_state: None,
            pending_pair_started_at: None,
            last_pair_attempt_at: None,
        }
    }
}

pub fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ankara-connector")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_ts_secs(raw: &str) -> Option<u64> {
    raw.parse().ok()
}

pub fn pending_pair_valid(cfg: &ConnectorConfig) -> bool {
    let Some(state) = cfg.pending_pair_state.as_ref() else {
        return false;
    };
    if state.len() < 8 {
        return false;
    }
    let Some(started) = cfg
        .pending_pair_started_at
        .as_ref()
        .and_then(|s| parse_ts_secs(s))
    else {
        return false;
    };
    now_secs().saturating_sub(started) <= PAIR_STATE_TTL_SECS
}

pub fn pair_cooldown_active(cfg: &ConnectorConfig) -> bool {
    let Some(last) = cfg
        .last_pair_attempt_at
        .as_ref()
        .and_then(|s| parse_ts_secs(s))
    else {
        return false;
    };
    now_secs().saturating_sub(last) < 60
}

pub fn load_config() -> ConnectorConfig {
    let path = config_path();
    let mut cfg = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        ConnectorConfig::default()
    };

    if cfg.token.is_none() {
        if let Ok(entry) = keyring::Entry::new(SERVICE, TOKEN_ACCOUNT) {
            if let Ok(secret) = entry.get_password() {
                if !secret.is_empty() {
                    cfg.token = Some(secret);
                }
            }
        }
    }

    if cfg.token.as_ref().is_some_and(|t| !t.is_empty()) && cfg.device_id.is_none() {
        log::warn!("Bozuk oturum (token var, cihaz kimliği yok) — temizleniyor.");
        let _ = clear_session_inner(&mut cfg);
    }

    if !pending_pair_valid(&cfg) {
        cfg.pending_pair_state = None;
        cfg.pending_pair_started_at = None;
    }

    cfg
}

pub fn save_config(cfg: &ConnectorConfig) -> Result<()> {
    fs::create_dir_all(config_dir()).context("config dir")?;
    let path = config_path();
    let tmp = path.with_extension("json.tmp");
    let mut disk = cfg.clone();
    disk.token = None;
    let json = serde_json::to_string_pretty(&disk)?;
    fs::write(&tmp, json).context("write config temp")?;
    fs::rename(&tmp, &path).context("rename config")?;

    if let Some(token) = &cfg.token {
        let entry = keyring::Entry::new(SERVICE, TOKEN_ACCOUNT)?;
        entry.set_password(token).context("keyring write")?;
    } else {
        let _ = keyring::Entry::new(SERVICE, TOKEN_ACCOUNT).and_then(|e| e.delete_credential());
    }
    Ok(())
}

fn clear_session_inner(cfg: &mut ConnectorConfig) -> Result<()> {
    cfg.token = None;
    cfg.device_id = None;
    cfg.tenant_name = None;
    cfg.paired_at = None;
    cfg.session_paused = true;
    cfg.pending_pair_state = None;
    cfg.pending_pair_started_at = None;
    save_config(cfg)
}

pub fn clear_session() -> Result<()> {
    let mut cfg = load_config();
    clear_session_inner(&mut cfg)
}

pub fn clear_pending_pair(cfg: &mut ConnectorConfig) {
    cfg.pending_pair_state = None;
    cfg.pending_pair_started_at = None;
}

pub fn is_paired(cfg: &ConnectorConfig) -> bool {
    cfg.token.as_ref().is_some_and(|t| !t.is_empty()) && cfg.device_id.is_some()
}

pub fn timestamp_now() -> String {
    format!("{}", now_secs())
}
