//! Ankara Yazılım Connector v2 — single Rust binary, cloud relay.

// Release builds: GUI-only (no console window on Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod instance;

use anyhow::Result;
use connector_cloud::{run_agent_loop, run_heartbeat_loop, start_login_flow};
use connector_config::load_config;
use connector_tray::{notify_login_result, run_tray, TrayActions};
use connector_update::{start_auto_update_loop, try_apply_stored_update};
use instance::{claim_single_instance, handle_duplicate_launch, terminate_legacy_connectors, InstanceClaim};
use log::info;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    terminate_legacy_connectors();

    match claim_single_instance()? {
        InstanceClaim::AlreadyRunning => {
            info!("Connector zaten çalışıyor — panel açılıyor.");
            handle_duplicate_launch();
            return Ok(());
        }
        InstanceClaim::Primary(_guard) => {}
    }

    info!("Ankara Yazılım Connector v{}", connector_cloud::CONNECTOR_VERSION);

    let _ = try_apply_stored_update().await;

    let cfg = load_config();
    start_auto_update_loop(cfg);

    let (_shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let (login_tx, mut login_rx) = mpsc::unbounded_channel();
    let (logout_tx, mut logout_rx) = mpsc::unbounded_channel();

    let shutdown_agent = shutdown_rx.clone();
    tokio::spawn(async move {
        let _ = run_agent_loop(shutdown_agent).await;
    });

    let shutdown_hb = shutdown_rx.clone();
    tokio::spawn(async move {
        let _ = run_heartbeat_loop(shutdown_hb).await;
    });

    tokio::spawn(async move {
        while login_rx.recv().await.is_some() {
            match start_login_flow().await {
                Ok(_) => notify_login_result(true, None),
                Err(e) => notify_login_result(false, Some(&e.to_string())),
            }
        }
    });

    tokio::spawn(async move {
        while logout_rx.recv().await.is_some() {
            let _ = connector_cloud::logout_session();
        }
    });

    let actions = TrayActions { login_tx, logout_tx };

    // Tray + Win32 message pump must stay on one dedicated thread (not tokio).
    std::thread::Builder::new()
        .name("connector-tray".into())
        .spawn(move || {
            if let Err(e) = run_tray(actions) {
                log::error!("Tray hatası: {e}");
            }
        })?;

    // Keep process alive while tray thread runs (Windows GUI has no console ctrl-c).
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}
