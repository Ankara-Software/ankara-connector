use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use connector_config::{
    clear_pending_pair, is_paired, load_config, pair_cooldown_active, pending_pair_valid,
    save_config, timestamp_now, ConnectorConfig,
};
use log::{info, warn};
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

struct PairPayload {
    token: String,
    device_id: String,
    tenant_name: Option<String>,
}

async fn fetch_pair_result(state: &str, claim: bool) -> Result<Option<PairPayload>> {
    let cfg = load_config();
    let client = reqwest::Client::new();
    let claim_param = if claim { "true" } else { "false" };
    let url = format!(
        "{}/connector/pair-result?state={state}&claim={claim_param}",
        cfg.api_base.trim_end_matches('/')
    );

    let res = client.get(&url).send().await.context("pair-result isteği")?;
    let status = res.status();
    if !status.is_success() {
        warn!("pair-result HTTP {status} state={}…", &state[..8.min(state.len())]);
        return Ok(None);
    }

    let json: serde_json::Value = res.json().await.context("pair-result JSON")?;
    if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = json
            .pointer("/error/message")
            .or_else(|| json.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("pair-result başarısız");
        anyhow::bail!("{msg}");
    }

    let data = json.get("data").cloned().unwrap_or_default();
    if data.get("ready").and_then(|v| v.as_bool()) != Some(true) {
        return Ok(None);
    }

    let token = data
        .get("token")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty())
        .context("pair-result token eksik")?
        .to_string();
    let device_id = data
        .get("deviceId")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty())
        .context("pair-result deviceId eksik")?
        .to_string();
    let tenant_name = data
        .get("tenantName")
        .and_then(|v| v.as_str())
        .map(String::from);

    Ok(Some(PairPayload {
        token,
        device_id,
        tenant_name,
    }))
}

fn apply_pairing(cfg: &mut ConnectorConfig, payload: PairPayload) -> Result<()> {
    cfg.token = Some(payload.token);
    cfg.device_id = Some(payload.device_id);
    if payload.tenant_name.is_some() {
        cfg.tenant_name = payload.tenant_name;
    }
    cfg.paired_at = Some(timestamp_now());
    cfg.session_paused = false;
    clear_pending_pair(cfg);
    cfg.last_pair_attempt_at = None;
    save_config(cfg)
}

pub async fn poll_pair_result(state: &str) -> Result<ConnectorConfig> {
    for attempt in 0..180 {
        match fetch_pair_result(state, false).await {
            Ok(Some(payload)) => {
                let mut next = load_config();
                apply_pairing(&mut next, payload)?;
                if fetch_pair_result(state, true).await?.is_none() {
                    warn!("pair-result claim onayı alınamadı (oturum kaydedildi)");
                }
                info!("Oturum açıldı — cihaz {:?}", next.device_id);
                return Ok(next);
            }
            Ok(None) => {}
            Err(e) => return Err(e),
        }
        if attempt > 0 && attempt % 15 == 0 {
            info!(
                "Oturum bekleniyor… tarayıcıda bağlantıyı tamamlayın (state={}…)",
                &state[..8.min(state.len())]
            );
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    let mut cfg = load_config();
    cfg.last_pair_attempt_at = Some(timestamp_now());
    let _ = save_config(&cfg);

    anyhow::bail!(
        "Tarayıcıda bağlantı tamamlandı ama Connector alamadı — uygulamayı yeniden başlatın ve aynı sekmede bağlanın."
    )
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

    if pending_pair_valid(&cfg) {
        let state = cfg.pending_pair_state.clone().unwrap();
        save_config(&cfg)?;
        info!("Bekleyen oturum kodu ile devam ediliyor…");
        return poll_pair_result(&state).await;
    }

    if pair_cooldown_active(&cfg) {
        info!("Oturum açma kısa süre önce denendi — bekleniyor.");
        return Ok(());
    }

    let state = pairing_state();
    cfg.pending_pair_state = Some(state.clone());
    cfg.pending_pair_started_at = Some(timestamp_now());
    cfg.last_pair_attempt_at = Some(timestamp_now());
    save_config(&cfg)?;

    open_pair_url(&state)?;
    poll_pair_result(&state).await
}

pub fn logout_session() -> Result<()> {
    connector_config::clear_session()
}
