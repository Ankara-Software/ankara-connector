use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use connector_config::{is_paired, load_config};
use connector_cloud::{logout_session, management_panel_url, CONNECTOR_VERSION};
use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::about::{show_about, show_message};

pub struct TrayActions {
    pub login_tx: tokio::sync::mpsc::UnboundedSender<()>,
    pub logout_tx: tokio::sync::mpsc::UnboundedSender<()>,
}

pub fn run_tray(actions: TrayActions) -> anyhow::Result<()> {
    let open_status = MenuItem::new("Yönetim panelini aç", true, None);
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

    let icon_path = resolve_icon_path();
    let icon = icon_path
        .as_ref()
        .and_then(|p| tray_icon::Icon::from_path(p, None).ok());

    let mut builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu.clone()))
        // Left click → panel; right click → context menu (Windows default).
        .with_menu_on_left_click(false)
        .with_tooltip("Ankara Yazılım Connector");

    if let Some(icon) = icon {
        builder = builder.with_icon(icon);
    } else if let Some(path) = icon_path {
        log::warn!("Tepsi simgesi yüklenemedi: {}", path.display());
    }

    let tray = builder.build()?;
    let tray_arc = Arc::new(tray);
    update_tooltip(&tray_arc);

    let open_id = open_status.id().clone();
    let login_id = login.id().clone();
    let logout_id = logout.id().clone();
    let about_id = about.id().clone();
    let quit_id = quit.id().clone();

    let mut last_tooltip = Instant::now();

    loop {
        pump_platform_events();

        while let Ok(ev) = TrayIconEvent::receiver().try_recv() {
            match ev {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
                | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => open_management_panel(),
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    // Right-click menu is handled by the shell; refresh state when opened.
                    update_visibility(&login, &logout);
                }
                _ => {}
            }
        }

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == open_id {
                open_management_panel();
            } else if event.id == login_id {
                let _ = actions.login_tx.send(());
            } else if event.id == logout_id {
                let _ = actions.logout_tx.send(());
                if logout_session().is_ok() {
                    update_visibility(&login, &logout);
                    update_tooltip(&tray_arc);
                }
            } else if event.id == about_id {
                show_about(CONNECTOR_VERSION, "rust", CONNECTOR_VERSION);
            } else if event.id == quit_id {
                std::process::exit(0);
            }
        }

        if last_tooltip.elapsed() >= Duration::from_secs(30) {
            update_visibility(&login, &logout);
            update_tooltip(&tray_arc);
            last_tooltip = Instant::now();
        }

        std::thread::sleep(Duration::from_millis(16));
    }
}

#[cfg(windows)]
fn pump_platform_events() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };

    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(not(windows))]
fn pump_platform_events() {}

fn resolve_icon_path() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("ankara-yazilim.ico");
            if bundled.is_file() {
                return Some(bundled);
            }
        }
    }
    let cwd = PathBuf::from("ankara-yazilim.ico");
    if cwd.is_file() {
        return Some(cwd);
    }
    None
}

fn update_visibility(login: &MenuItem, logout: &MenuItem) {
    let paired = is_paired(&load_config());
    let _ = login.set_enabled(!paired);
    let _ = logout.set_enabled(paired);
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

fn open_management_panel() {
    let url = if is_paired(&load_config()) {
        management_panel_url()
    } else {
        format!("{}/connector/baglan", connector_cloud::DEFAULT_SITE)
    };
    if let Err(e) = open::that(&url) {
        show_message("Panel açılamadı", &e.to_string(), true);
    }
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
