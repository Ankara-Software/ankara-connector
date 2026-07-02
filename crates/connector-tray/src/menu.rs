use std::sync::Arc;

use connector_config::{is_paired, load_config};
use connector_cloud::{logout_session, CONNECTOR_VERSION, DEFAULT_SITE};
use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder};

use crate::about::{show_about, show_message};

pub struct TrayActions {
    pub login_tx: tokio::sync::mpsc::UnboundedSender<()>,
    pub logout_tx: tokio::sync::mpsc::UnboundedSender<()>,
}

pub fn run_tray(actions: TrayActions) -> anyhow::Result<()> {
    let open_status = MenuItem::new("Durumu Aç", true, None);
    let login = MenuItem::new("Oturum aç…", true, None);
    let logout = MenuItem::new("Oturumu Kapat", true, None);
    let about = MenuItem::new("Hakkında…", true, None);
    let quit = MenuItem::new("Çıkış", true, None);

    let menu = Menu::new();
    menu.append(&open_status)?;
    menu.append(&login)?;
    menu.append(&logout)?;
    menu.append(&about)?;
    menu.append(&PredefinedMenuItem::separator())?;
    menu.append(&quit)?;

    update_visibility(&login, &logout);

    let icon = tray_icon::Icon::from_path("ankara-yazilim.ico", None).ok();
    let mut builder = TrayIconBuilder::new().with_menu(Box::new(menu.clone()));
    if let Some(icon) = icon {
        builder = builder.with_icon(icon);
    }
    let tray = builder.build()?;

    let tray_arc = Arc::new(tray);
    update_tooltip(&tray_arc);

    let menu_channel = MenuEvent::receiver();
    loop {
        match menu_channel.recv_timeout(std::time::Duration::from_secs(4)) {
            Ok(event) => {
                if event.id == open_status.id() {
                    let _ = open::that(DEFAULT_SITE);
                } else if event.id == login.id() {
                    let _ = actions.login_tx.send(());
                } else if event.id == logout.id() {
                    let _ = actions.logout_tx.send(());
                    if logout_session().is_ok() {
                        update_visibility(&login, &logout);
                        update_tooltip(&tray_arc);
                    }
                } else if event.id == about.id() {
                    show_about(CONNECTOR_VERSION, "rust", CONNECTOR_VERSION);
                } else if event.id == quit.id() {
                    std::process::exit(0);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                update_visibility(&login, &logout);
                update_tooltip(&tray_arc);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

fn update_visibility(login: &MenuItem, logout: &MenuItem) {
    let paired = is_paired(&load_config());
    login.set_enabled(!paired);
    logout.set_enabled(paired);
}

fn update_tooltip(tray: &TrayIcon) {
    let cfg = load_config();
    let text = if is_paired(&cfg) {
        let label = cfg
            .tenant_name
            .clone()
            .or_else(|| cfg.label.clone())
            .or_else(|| cfg.device_id.clone())
            .unwrap_or_else(|| "Bağlı".into());
        format!("Ankara Yazılım Connector — Bağlı ({label})")
    } else if cfg.session_paused {
        "Ankara Yazılım Connector — Oturum kapalı".into()
    } else {
        "Ankara Yazılım Connector — Oturum bekleniyor".into()
    };
    let _ = tray.set_tooltip(Some(&text));
}

pub fn notify_login_result(ok: bool, err: Option<&str>) {
    if ok {
        show_message(
            "Oturum aç",
            "Tarayıcıda oturum açma tamamlandı.",
            false,
        );
    } else {
        show_message(
            "Oturum aç",
            err.unwrap_or("Oturum açılamadı."),
            true,
        );
    }
}
