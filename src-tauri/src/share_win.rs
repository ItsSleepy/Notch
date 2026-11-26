//! Windows bits for phone share: copied files on the clipboard, and whether Notch runs as admin
//! (Windows blocks dragging files from Explorer into an elevated app).

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_HDROP: u32 = 15;

    /// Paths of files copied in Explorer (Ctrl+C), if that's what's on the clipboard.
    pub fn clipboard_files() -> Vec<String> {
        let mut out = Vec::new();
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP).is_err() || OpenClipboard(HWND::default()).is_err() {
                return out;
            }
            if let Ok(handle) = GetClipboardData(CF_HDROP) {
                let drop = HDROP(handle.0);
                let count = DragQueryFileW(drop, u32::MAX, None);
                for i in 0..count.min(200) {
                    let len = DragQueryFileW(drop, i, None) as usize;
                    let mut buf = vec![0u16; len + 1];
                    let got = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
                    out.push(String::from_utf16_lossy(&buf[..got]));
                }
            }
            let _ = CloseClipboard();
        }
        out
    }

    pub fn is_elevated() -> bool {
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return false;
            }
            let mut info = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut info as *mut _ as *mut core::ffi::c_void),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
            .is_ok();
            let _ = CloseHandle(token);
            ok && info.TokenIsElevated != 0
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn clipboard_files() -> Vec<String> {
        Vec::new()
    }
    pub fn is_elevated() -> bool {
        false
    }
}

pub use imp::{clipboard_files, is_elevated};
