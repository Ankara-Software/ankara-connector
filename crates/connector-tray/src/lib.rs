//! Native system tray — session menu, native About dialog, status tooltip.

mod about;
mod menu;

pub use menu::{notify_login_result, run_tray, TrayActions};
