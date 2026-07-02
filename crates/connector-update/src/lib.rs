//! Safe auto-update — poll release API, verify SHA-256, apply on restart.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result};
use connector_config::{config_dir, load_config, save_config, ConnectorConfig, PendingUpdate};
use log::{info, warn};
use sha2::{Digest, Sha256};

const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60 * 6);
const WIN_APP_EXE: &str = "AnkaraConnector.exe";
const WIN_INSTALL_DIR: &str = r"C:\Program Files\Ankara Yazilim\Connector";

pub fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-x64"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "macos-arm64"
        } else {
            "macos-x64"
        }
    } else {
        "linux-x64"
    }
}

fn updates_dir() -> PathBuf {
    let dir = config_dir().join("updates");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn api_origin(api_base: &str) -> String {
    api_base
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string()
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn is_setup_artifact(pending: &PendingUpdate) -> bool {
    let name = pending.filename.to_lowercase();
    name.contains("setup") || name.contains("ankaraconnector-setup")
}

async fn fetch_update_check(api_base: &str, current: &str) -> Result<Option<serde_json::Value>> {
    let origin = api_origin(api_base);
    let platform = platform_key();
    let url = format!(
        "{origin}/v1/public/releases/check?product=connector&platform={platform}&current={current}"
    );
    let client = reqwest::Client::new();
    let res = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await?
        .error_for_status()?;
    let json: serde_json::Value = res.json().await?;
    Ok(json.get("data").cloned())
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path).context("read update file")?;
    let hash = Sha256::digest(bytes);
    Ok(hex::encode(hash))
}

pub async fn download_pending_update(api_base: &str, current: &str) -> Result<Option<PendingUpdate>> {
    let data = match fetch_update_check(api_base, current).await? {
        Some(d) => d,
        None => return Ok(None),
    };

    if !data.get("updateAvailable").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(None);
    }

    let download_url = data
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .context("downloadUrl missing")?;
    let sha256 = data
        .get("sha256")
        .and_then(|v| v.as_str())
        .context("sha256 missing")?;
    let version = data
        .get("latest")
        .and_then(|v| v.as_str())
        .unwrap_or(current)
        .to_string();
    let filename = data
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or("AnkaraConnector-Setup.exe")
        .to_string();

    let dest = updates_dir().join(format!("{version}-{filename}"));
    let client = reqwest::Client::new();
    let bytes = client
        .get(download_url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    fs::write(&dest, &bytes).context("write update")?;
    let hash = hex::encode(Sha256::digest(&bytes));
    if !hash.eq_ignore_ascii_case(sha256) {
        let _ = fs::remove_file(&dest);
        anyhow::bail!("SHA-256 doğrulaması başarısız");
    }

    Ok(Some(PendingUpdate {
        version,
        path: dest.to_string_lossy().into_owned(),
        sha256: sha256.to_string(),
        filename,
    }))
}

pub async fn stage_update_if_available(cfg: &ConnectorConfig) -> Result<Option<PendingUpdate>> {
    let pending = download_pending_update(&cfg.api_base, &current_version()).await?;
    if let Some(ref p) = pending {
        let mut disk = load_config();
        disk.pending_update = Some(p.clone());
        save_config(&disk)?;
        info!("Güncelleme hazır: {} (yeniden başlatınca uygulanır)", p.version);
    }
    Ok(pending)
}

fn write_windows_setup_script(pending_path: &str) -> Result<PathBuf> {
    let script = updates_dir().join("apply-update.cmd");
    let tray = format!(r"{WIN_INSTALL_DIR}\{WIN_APP_EXE}");
    let content = format!(
        "@echo off\r\n\
         taskkill /F /IM {WIN_APP_EXE} /T 2>nul\r\n\
         ping 127.0.0.1 -n 2 > nul\r\n\
         \"{pending_path}\" /S\r\n\
         ping 127.0.0.1 -n 2 > nul\r\n\
         start \"\" \"{tray}\"\r\n\
         del \"%~f0\"\r\n"
    );
    fs::write(&script, content)?;
    Ok(script)
}

fn write_windows_binary_script(pending_path: &str, target_exe: &str) -> Result<PathBuf> {
    let script = updates_dir().join("apply-update.cmd");
    let tray = format!(r"{WIN_INSTALL_DIR}\{WIN_APP_EXE}");
    let content = format!(
        "@echo off\r\n\
         ping 127.0.0.1 -n 3 > nul\r\n\
         taskkill /F /IM {WIN_APP_EXE} /T 2>nul\r\n\
         copy /Y \"{pending_path}\" \"{target_exe}\"\r\n\
         start \"\" \"{tray}\"\r\n\
         del \"%~f0\"\r\n"
    );
    fs::write(&script, content)?;
    Ok(script)
}

pub fn apply_pending_update(pending: &PendingUpdate) -> Result<bool> {
    let path = Path::new(&pending.path);
    if !path.exists() {
        return Ok(false);
    }
    let hash = sha256_file(path)?;
    if !hash.eq_ignore_ascii_case(&pending.sha256) {
        anyhow::bail!("Bekleyen güncelleme SHA-256 uyuşmuyor");
    }

    let mut cfg = load_config();
    cfg.pending_update = None;
    save_config(&cfg)?;

    let script = if cfg!(target_os = "windows") {
        if is_setup_artifact(pending) {
            write_windows_setup_script(&pending.path)?
        } else {
            let target = std::env::current_exe()
                .unwrap_or_else(|_| PathBuf::from(format!(r"{WIN_INSTALL_DIR}\{WIN_APP_EXE}")));
            write_windows_binary_script(&pending.path, &target.to_string_lossy())?
        }
    } else {
        let target = std::env::current_exe()?;
        let script = updates_dir().join("apply-update.sh");
        let content = format!(
            "#!/bin/sh\nsleep 2\ncp \"{}\" \"{}\"\nchmod +x \"{}\"\nexec \"{}\"\n",
            pending.path,
            target.display(),
            target.display(),
            target.display()
        );
        fs::write(&script, content)?;
        script
    };

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/c", &script.to_string_lossy()])
            .spawn()
            .context("spawn apply script")?;
    } else {
        Command::new("/bin/sh")
            .arg(&script)
            .spawn()
            .context("spawn apply script")?;
    }
    Ok(true)
}

pub async fn try_apply_stored_update() -> Result<bool> {
    let cfg = load_config();
    let Some(pending) = cfg.pending_update.clone() else {
        return Ok(false);
    };
    info!("Bekleyen güncelleme uygulanıyor: {}", pending.version);
    if apply_pending_update(&pending)? {
        std::process::exit(0);
    }
    Ok(false)
}

pub fn start_auto_update_loop(cfg: ConnectorConfig) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            if let Err(e) = stage_update_if_available(&cfg).await {
                warn!("Güncelleme kontrolü: {e}");
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

pub fn pending_update_summary(cfg: &ConnectorConfig) -> Option<PendingUpdate> {
    cfg.pending_update.clone()
}
