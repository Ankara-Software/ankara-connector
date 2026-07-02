use std::time::Duration;

use anyhow::Result;
use connector_config::{load_config, ConnectorConfig};
use connector_drivers::advertised_capabilities;
use log::warn;

pub async fn run_heartbeat_loop(shutdown: tokio::sync::watch::Receiver<bool>) -> Result<()> {
    let client = reqwest::Client::new();
    loop {
        if *shutdown.borrow() {
            break;
        }
        let cfg = load_config();
        if let (Some(payload), Some(token)) = (build_payload(&cfg), cfg.token.as_ref()) {
            let url = format!("{}/connector/heartbeat", cfg.api_base.trim_end_matches('/'));
            match client.post(url).bearer_auth(token).json(&payload).send().await {
                Ok(res) if res.status() == 401 => {
                    warn!("Oturum iptal edildi — yerel oturum kapatılıyor");
                    let _ = connector_config::clear_session();
                }
                Ok(_) => {}
                Err(e) => warn!("Heartbeat hatası: {e}"),
            }
        }
        tokio::time::sleep(Duration::from_secs(180)).await;
    }
    Ok(())
}

fn build_payload(cfg: &ConnectorConfig) -> Option<serde_json::Value> {
    if cfg.token.is_none() {
        return None;
    }
    Some(serde_json::json!({
        "deviceId": cfg.device_id,
        "version": crate::CONNECTOR_VERSION,
        "os": std::env::consts::OS,
        "capabilities": advertised_capabilities(cfg),
    }))
}
