//! Single-instance guard — enterprise agents must not spawn duplicate tray icons.

use anyhow::Result;
use connector_cloud::management_panel_url;
use log::warn;

const MUTEX_NAME: &str = "Global\\AnkaraYazilimConnector.v2";

pub enum InstanceClaim {
    Primary(InstanceGuard),
    AlreadyRunning,
}

pub struct InstanceGuard {
    #[cfg(windows)]
    handle: windows::Win32::Foundation::HANDLE,
    #[cfg(not(windows))]
    _lock: std::fs::File,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

/// Terminate legacy v1 tray/core processes so only one Connector icon remains.
pub fn terminate_legacy_connectors() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        for exe in ["AnkaraYazilimConnector.exe", "ankara-connector-core.exe"] {
            let status = std::process::Command::new("taskkill")
                .args(["/F", "/IM", exe, "/T"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            if let Ok(s) = status {
                if s.success() {
                    warn!("Legacy Connector sonlandırıldı: {exe}");
                }
            }
        }
    }
}

pub fn claim_single_instance() -> Result<InstanceClaim> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
        use windows::Win32::System::Threading::CreateMutexW;

        fn wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(Some(0)).collect()
        }

        unsafe {
            let name = wide(MUTEX_NAME);
            let handle = CreateMutexW(None, true, PCWSTR(name.as_ptr()))?;
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(handle);
                return Ok(InstanceClaim::AlreadyRunning);
            }
            return Ok(InstanceClaim::Primary(InstanceGuard { handle }));
        }
    }

    #[cfg(not(windows))]
    {
        use std::fs::OpenOptions;
        use std::io::Write;

        let path = connector_config::config_dir().join("instance.lock");
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                let _ = writeln!(file, "{}", std::process::id());
                Ok(InstanceClaim::Primary(InstanceGuard { _lock: file }))
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                Ok(InstanceClaim::AlreadyRunning)
            }
            Err(e) => Err(e.into()),
        }
    }
}

/// Second launch: open panel in browser and exit quietly.
pub fn handle_duplicate_launch() {
    let url = management_panel_url();
    let _ = open::that(&url);
}
