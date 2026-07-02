use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use connector_config::{is_paired, load_config};
use connector_cloud::{management_panel_url, CONNECTOR_VERSION};
use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::about::{show_about, show_message};

pub struct TrayActions {
    pub login_tx: tokio::sync::mpsc::UnboundedSender<()>,
    pub logout_tx: tokio::sync::mpsc::UnboundedSender<()>,
    pub session_refresh_rx: std::sync::mpsc::Receiver<()>,
}

struct AuthMenu {
    menu: Menu,
    login: MenuItem,
    logout: MenuItem,
    login_visible: bool,
    logout_visible: bool,
}

impl AuthMenu {
    fn new(menu: Menu, login: MenuItem, logout: MenuItem) -> Self {
        Self {
            menu,
            login,
            logout,
            login_visible: false,
            logout_visible: false,
        }
    }

    fn sync(&mut self) {
        let paired = is_paired(&load_config());
        if paired {
            if self.login_visible {
                let _ = self.menu.remove(&self.login);
                self.login_visible = false;
            }
            if !self.logout_visible {
                let _ = self.menu.insert(&self.logout, 1);
                self.logout_visible = true;
            }
        } else {
            if self.logout_visible {
                let _ = self.menu.remove(&self.logout);
                self.logout_visible = false;
            }
            if !self.login_visible {
                let _ = self.menu.insert(&self.login, 1);
                self.login_visible = true;
            }
        }
    }
}

pub fn run_tray(actions: TrayActions) -> anyhow::Result<()> {
    let open_status = MenuItem::new("Yönetim panelini aç", true, None);
    let login = MenuItem::new("Oturum aç…", true, None);
    let logout = MenuItem::new("Oturumu Kapat", true, None);
    let about = MenuItem::new("Hakkında…", true, None);
    let quit = MenuItem::new("Çıkış", true, None);

    let menu = Menu::new();
    menu.append(&open_status)?;
    menu.append(&about)?;
    menu.append(&PredefinedMenuItem::separator())?;
    menu.append(&quit)?;

    let mut auth = AuthMenu::new(menu.clone(), login.clone(), logout.clone());
    auth.sync();

    let icon_path = resolve_icon_path();
    let icon = icon_path
        .as_ref()
        .and_then(|p| tray_icon::Icon::from_path(p, None).ok());

    let mut builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu.clone()))
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

        while actions.session_refresh_rx.try_recv().is_ok() {
            auth.sync();
            update_tooltip(&tray_arc);
        }

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
                } => open_management_panel(&actions),
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    auth.sync();
                }
                _ => {}
            }
        }

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == open_id {
                open_management_panel(&actions);
            } else if event.id == login_id {
                let _ = actions.login_tx.send(());
            } else if event.id == logout_id {
                let _ = actions.logout_tx.send(());
            } else if event.id == about_id {
                show_about(CONNECTOR_VERSION, "rust", CONNECTOR_VERSION);
            } else if event.id == quit_id {
                std::process::exit(0);
            }
        }

        if last_tooltip.elapsed() >= Duration::from_secs(15) {
            auth.sync();
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

fn open_management_panel(actions: &TrayActions) {
    if is_paired(&load_config()) {
        if let Err(e) = open::that(management_panel_url()) {
            show_message("Panel açılamadı", &e.to_string(), true);
        }
    } else {
        let _ = actions.login_tx.send(());
    }
}

pub fn notify_login_result(ok: bool, err: Option<&str>) {
    if !ok {
        show_message(
            "Oturum aç",
            err.unwrap_or("Oturum açılamadı."),
            true,
        );
    }
}
