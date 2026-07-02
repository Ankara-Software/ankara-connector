//! Local Connector configuration + secure token storage.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "ankara-connector";
const TOKEN_ACCOUNT: &str = "device-token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub code_page: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorConfig {
    #[serde(default = "default_api_base")]
    pub api_base: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub tenant_name: Option<String>,
    #[serde(default)]
    pub paired_at: Option<String>,
    #[serde(default)]
    pub printer: Option<PrinterConfig>,
    #[serde(default)]
    pub session_paused: bool,
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
            session_paused: false,
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

    cfg
}

pub fn save_config(cfg: &ConnectorConfig) -> Result<()> {
    fs::create_dir_all(config_dir()).context("config dir")?;
    let mut disk = cfg.clone();
    if let Some(token) = &cfg.token {
        let entry = keyring::Entry::new(SERVICE, TOKEN_ACCOUNT)?;
        entry.set_password(token)?;
        disk.token = None;
    } else {
        let _ = keyring::Entry::new(SERVICE, TOKEN_ACCOUNT).and_then(|e| e.delete_password());
    }
    fs::write(config_path(), serde_json::to_string_pretty(&disk)?).context("write config")?;
    Ok(())
}

pub fn clear_session() -> Result<()> {
    let mut cfg = load_config();
    cfg.token = None;
    cfg.device_id = None;
    cfg.tenant_name = None;
    cfg.paired_at = None;
    cfg.session_paused = true;
    save_config(&cfg)
}

pub fn is_paired(cfg: &ConnectorConfig) -> bool {
    cfg.token.as_ref().is_some_and(|t| !t.is_empty()) && cfg.device_id.is_some()
}
