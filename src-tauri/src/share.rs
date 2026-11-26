//! Tauri side of phone share (the server itself is in share_core.rs).
//! Received files go to Downloads\Notch Share; state lives next to config.json as share.json.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::share_core::{Share, ShareEvent, Status, DEFAULT_PORT};
use crate::suspend::SuspendState;

pub struct ShareState(pub Share);

pub fn init(app: &AppHandle) -> ShareState {
    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Notch Share");
    let state_path = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("share.json");
    let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());

    let handle = app.clone();
    let share = Share::new(
        dir,
        state_path,
        pc_name,
        Box::new(move |event| {
            // A finished file pops the bar down for a moment (not while a game is fullscreen).
            if matches!(event, ShareEvent::Received { .. }) && !handle.state::<SuspendState>().suspended() {
                crate::bar::peek(&handle, 4000);
            }
            let _ = handle.emit("share://event", event);
        }),
    );
    share.start_if_enabled(DEFAULT_PORT);
    ShareState(share)
}

/// explorer.exe with a pre-quoted argument (it doesn't follow the usual quoting rules).
fn explorer(arg: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(arg);
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    cmd.arg(arg);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn share_status(share: State<'_, ShareState>) -> Result<Status, String> {
    let s = share.0.clone();
    tauri::async_runtime::spawn_blocking(move || s.status()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn share_enable(on: bool, share: State<'_, ShareState>) -> Result<(), String> {
    share.0.set_enabled(on, DEFAULT_PORT)
}

#[tauri::command]
pub fn share_reset(share: State<'_, ShareState>) {
    share.0.reset_token();
}

/// Files dropped on the bar: offered to the phone until removed.
#[tauri::command]
pub fn share_offer(paths: Vec<String>, share: State<'_, ShareState>) -> usize {
    share.0.offer(&paths)
}

#[tauri::command]
pub fn share_unoffer(id: String, share: State<'_, ShareState>) {
    share.0.unoffer(&id);
}

/// what: "offers" | "received"
#[tauri::command]
pub fn share_clear(what: String, share: State<'_, ShareState>) {
    match what.as_str() {
        "offers" => share.0.clear_offers(),
        "received" => share.0.clear_received(),
        _ => {}
    }
}

/// what: "folder" (the share folder), "open" (a received file), "reveal" (a received file in Explorer).
/// Only files Notch itself received can be opened.
#[tauri::command]
pub fn share_open(what: String, name: Option<String>, share: State<'_, ShareState>) -> Result<(), String> {
    match what.as_str() {
        "folder" => {
            let dir = share.0.dir().to_path_buf();
            let _ = std::fs::create_dir_all(&dir);
            explorer(format!("\"{}\"", dir.display()))
        }
        "open" | "reveal" => {
            let path = name
                .as_deref()
                .and_then(|n| share.0.received_path(n))
                .ok_or("That file isn't in the share folder any more")?;
            if what == "open" {
                explorer(format!("\"{}\"", path.display()))
            } else {
                explorer(format!("/select,\"{}\"", path.display()))
            }
        }
        _ => Err(format!("unknown target {what}")),
    }
}

/// "Choose files": the Windows file picker. Returns how many were offered.
/// Runs on its own new thread: the dialog needs a single-threaded COM apartment, and the shared
/// worker threads are already multithreaded (audio/media), where the dialog silently fails.
#[tauri::command]
pub async fn share_pick(share: State<'_, ShareState>) -> Result<usize, String> {
    let s = share.0.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("notch-pick".into())
        .spawn(move || {
            #[cfg(windows)]
            let paths: Vec<String> = rfd::FileDialog::new()
                .set_title("Send to phone")
                .pick_files()
                .unwrap_or_default()
                .iter()
                .map(|p| p.display().to_string())
                .collect();
            #[cfg(not(windows))]
            let paths: Vec<String> = Vec::new();
            let _ = tx.send(s.offer(&paths));
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

/// "Paste": files copied in Explorer (Ctrl+C). Works even when dragging is blocked.
/// Ok(0) with nothing on the clipboard.
#[tauri::command]
pub async fn share_paste(share: State<'_, ShareState>) -> Result<usize, String> {
    let s = share.0.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(s.offer(&crate::share_win::clipboard_files()));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

/// Notch is running as administrator: Windows won't let files be dragged onto it from Explorer.
#[tauri::command]
pub fn share_elevated() -> bool {
    crate::share_win::is_elevated()
}
