use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use connector_config::{load_config, ConnectorConfig};
use connector_drivers::advertised_capabilities;
use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde_json::Value;
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use connector_protocol::{decode, encode, ConnectorMessage};

use crate::CONNECTOR_VERSION;

fn ws_url(cfg: &ConnectorConfig) -> Result<String> {
    let token = cfg
        .token
        .as_ref()
        .filter(|t| !t.is_empty())
        .context("Oturum yok")?;
    let base = cfg.api_base.replace("https://", "wss://").replace("http://", "ws://");
    Ok(format!("{base}/connector/agent?token={token}"))
}

pub async fn run_agent_loop(shutdown: tokio::sync::watch::Receiver<bool>) -> Result<()> {
    loop {
        if *shutdown.borrow() {
            break;
        }

        let cfg = load_config();
        if cfg.session_paused || cfg.token.is_none() {
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }

        let url = match ws_url(&cfg) {
            Ok(u) => u,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        info!("Cloud WSS bağlanıyor…");
        match connect_async(&url).await {
            Ok((ws, _)) => {
                let (mut write, mut read) = ws.split();
                let cfg_arc = Arc::new(RwLock::new(load_config()));

                let hello = ConnectorMessage::Hello {
                    v: connector_protocol::PROTOCOL_VERSION,
                    agent: connector_protocol::AgentInfo {
                        name: "Ankara Connector".into(),
                        version: CONNECTOR_VERSION.into(),
                        os: std::env::consts::OS.into(),
                    },
                    capabilities: advertised_capabilities(&cfg),
                };
                write
                    .send(Message::Text(encode(&hello)?))
                    .await
                    .context("hello send")?;

                loop {
                    tokio::select! {
                        _ = shutdown.changed() => {
                            if *shutdown.borrow() { break; }
                        }
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(ConnectorMessage::Command { id, cap, action, payload, .. }) = decode(&text) {
                                        let cfg = cfg_arc.read().await.clone();
                                        let ack = connector_drivers::dispatch_command_with_id(
                                            &cfg, &id, &cap, &action, payload,
                                        ).await;
                                        write.send(Message::Text(encode(&ack)?)).await.ok();
                                    } else if let Ok(ConnectorMessage::Ping { .. }) = decode(&text) {
                                        write.send(Message::Text(encode(&ConnectorMessage::Pong { v: 1 })?)).await.ok();
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => break,
                                Some(Err(e)) => {
                                    warn!("WSS okuma hatası: {e}");
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Cloud WSS bağlantı hatası: {e}"),
        }

        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    Ok(())
}

pub async fn post_event(cfg: &ConnectorConfig, cap: &str, event: &str, payload: Option<Value>) -> Result<()> {
    let token = cfg.token.as_ref().context("token")?;
    let client = reqwest::Client::new();
    let url = format!("{}/connector/event", cfg.api_base.trim_end_matches('/'));
    client
        .post(url)
        .bearer_auth(token)
        .json(&serde_json::json!({ "cap": cap, "event": event, "payload": payload }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
