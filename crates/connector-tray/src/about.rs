//! Native About dialog (Windows MessageBox; fallback log elsewhere).

pub fn show_about(version: &str, build: &str, core_bun: &str) {
    let body = format!(
        "Ankara Yazılım Connector\r\n\r\n\
         Sürüm: {version} ({build})\r\n\
         Çekirdek: Rust {core_bun}\r\n\
         İşletim sistemi: {os}/{arch}\r\n\r\n\
         Fiziksel donanımı Ankara Yazılım paneli ile köprüler.\r\n\
         Tüm ayarlar web panelden yapılır.\r\n\r\n\
         Gizlilik: https://ankarayazilim.org/gizlilik/\r\n\
         KVKK: https://ankarayazilim.org/kvkk/\r\n\
         İndir: https://ankarayazilim.org/indir",
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
    );
    show_native_dialog("Ankara Yazılım Connector", &body);
}

pub fn show_message(title: &str, body: &str, is_error: bool) {
    show_native_dialog(title, body);
    let _ = is_error;
}

#[cfg(windows)]
fn show_native_dialog(title: &str, body: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    unsafe {
        let _ = MessageBoxW(
            None,
            windows::core::PCWSTR(to_wide(body).as_ptr()),
            windows::core::PCWSTR(to_wide(title).as_ptr()),
            MB_OK | MB_ICONINFORMATION,
        );
    }
}

#[cfg(not(windows))]
fn show_native_dialog(title: &str, body: &str) {
    log::info!("{title}: {body}");
}
