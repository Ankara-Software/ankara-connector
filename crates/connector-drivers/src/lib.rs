//! POS hardware drivers — ESC/POS printer, drawer kick, scanner events.

mod escpos;
mod host;

pub use host::{dispatch_command, dispatch_command_with_id, advertised_capabilities, DriverHost};
