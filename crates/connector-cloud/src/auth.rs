use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use connector_config::{is_paired, load_config, save_config, ConnectorConfig};
use log::info;
use uuid::Uuid;

use crate::{CONNECTOR_VERSION, DEFAULT_SITE};

static LOGIN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub fn pairing_state() -> String {
    Uuid::new_v4().to_string()
}

pub fn open_pair_url(state: &str) -> Result<()> {
    let caps = "printer.escpos,scanner.barcode,scanner.qr,drawer.kick,signature.esign";
    let os = std::env::consts::OS;
    let url = format!(
        "{DEFAULT_SITE}/connector/baglan?state={state}&port=0&os={os}&v={CONNECTOR_VERSION}&caps={caps}"
    );
    open::that(&url).context("tarayıcı açılamadı")
}

pub async fn poll_pair_result(state: &str) -> Result<ConnectorConfig> {
    let cfg = load_config();
    let client = reqwest::Client::new();
    let url = format!(
        "{}/connector/pair-result?state={state}&claim=true",
        cfg.api_base.trim_end_matches('/')
    );

    for _ in 0..180 {
        if let Ok(res) = client.get(&url).send().await {
            if res.status().is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                        let data = json.get("data").cloned().unwrap_or_default();
                        if data.get("ready").and_then(|v| v.as_bool()) == Some(true) {
                            let mut next = load_config();
                            next.token = data
                                .get("token")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            next.device_id = data
                                .get("deviceId")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            next.tenant_name = data
                                .get("tenantName")
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            next.paired_at = Some(chrono_lite_now());
                            next.session_paused = false;
                            save_config(&next)?;
                            info!("Oturum açıldı — cihaz {:?}", next.device_id);
                            return Ok(next);
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    anyhow::bail!("Oturum açma süresi doldu — tarayıcıda bağlantıyı tamamlayın.")
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

pub async fn start_login_flow() -> Result<()> {
    if is_paired(&load_config()) {
        return Ok(());
    }
    if LOGIN_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    struct LoginGuard;
    impl Drop for LoginGuard {
        fn drop(&mut self) {
            LOGIN_IN_PROGRESS.store(false, Ordering::SeqCst);
        }
    }
    let _guard = LoginGuard;

    let mut cfg = load_config();
    cfg.session_paused = false;
    save_config(&cfg)?;

    let state = pairing_state();
    open_pair_url(&state)?;
    poll_pair_result(&state).await?;
    Ok(())
}

pub fn logout_session() -> Result<()> {
    connector_config::clear_session()
}
