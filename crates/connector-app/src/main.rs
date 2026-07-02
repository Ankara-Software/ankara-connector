//! Ankara Yazılım Connector v2 — single Rust binary, cloud relay.

// Release builds: GUI-only (no console window on Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod instance;

use anyhow::Result;
use connector_cloud::{run_agent_loop, run_heartbeat_loop, start_login_flow};
use connector_config::{is_paired, load_config};
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
    let (session_refresh_tx, session_refresh_rx) = std::sync::mpsc::channel();

    let shutdown_agent = shutdown_rx.clone();
    tokio::spawn(async move {
        let _ = run_agent_loop(shutdown_agent).await;
    });

    let shutdown_hb = shutdown_rx.clone();
    tokio::spawn(async move {
        let _ = run_heartbeat_loop(shutdown_hb).await;
    });

    let refresh_after_login = session_refresh_tx.clone();
    tokio::spawn(async move {
        while login_rx.recv().await.is_some() {
            match start_login_flow().await {
                Ok(_) => {
                    let _ = refresh_after_login.send(());
                }
                Err(e) => notify_login_result(false, Some(&e.to_string())),
            }
        }
    });

    let refresh_after_logout = session_refresh_tx.clone();
    tokio::spawn(async move {
        while logout_rx.recv().await.is_some() {
            let _ = connector_cloud::logout_session();
            let _ = refresh_after_logout.send(());
        }
    });

    let auto_login_tx = login_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let cfg = load_config();
        if !is_paired(&cfg) && !cfg.session_paused {
            let _ = auto_login_tx.send(());
        }
    });

    let actions = TrayActions {
        login_tx,
        logout_tx,
        session_refresh_rx,
    };

    std::thread::Builder::new()
        .name("connector-tray".into())
        .spawn(move || {
            if let Err(e) = run_tray(actions) {
                log::error!("Tray hatası: {e}");
            }
        })?;

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}
