//! Native system tray — session menu, native About dialog, status tooltip.

pub mod about;
mod menu;

pub use menu::{notify_login_result, run_tray, TrayActions};
