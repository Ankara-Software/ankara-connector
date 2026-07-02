//! Cloud API client — WSS agent channel, heartbeat, web-pair poll.

mod agent_ws;
mod auth;
mod heartbeat;

pub use agent_ws::run_agent_loop;
pub use auth::{logout_session, start_login_flow};
pub use heartbeat::run_heartbeat_loop;

pub const CONNECTOR_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_SITE: &str = "https://ankarayazilim.org";
pub const PANEL_CONNECTOR_PATH: &str = "/panel/connector";

/// Browser URL for device pairing and management (panel).
pub fn management_panel_url() -> String {
    format!("{DEFAULT_SITE}{PANEL_CONNECTOR_PATH}")
}
