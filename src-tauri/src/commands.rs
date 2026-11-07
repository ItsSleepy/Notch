//! Everything the frontend can call. Blocking work runs on a worker thread so the UI never stalls.

use tauri::{AppHandle, State};

use crate::audio::{self, AudioSnapshot};
use crate::bar;
use crate::calendar::{CalState, CalendarData};
use crate::config::{Config, ConfigState};
use crate::media::{self, MediaInfo};
use crate::suspend::{SuspendInfo, SuspendState};
use crate::system::{SysState, SystemStats};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Run blocking work off the async runtime.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

// ---------- window / config / state ----------

/// The frontend grows the window to fit an open card and shrinks it back afterwards.
#[tauri::command]
pub fn bar_resize(app: AppHandle, height: f64) -> Result<(), String> {
    bar::place(&app, height.clamp(bar::BAR_H, 1200.0)).map_err(err)
}

/// Keep the bar open while a card is pinned (clicked) open, even if the mouse wanders off.
#[tauri::command]
pub fn bar_set_hold(app: AppHandle, hold: bool) {
    bar::set_hold(&app, hold);
}

/// Show the bar for a moment without the mouse (e.g. a timer finished).
#[tauri::command]
pub fn bar_peek(app: AppHandle, ms: u64) {
    bar::peek(&app, ms.min(60_000));
}

/// End times (unix ms) of running timers, so the bar pops open when one finishes.
#[tauri::command]
pub fn timer_alarms(app: AppHandle, ends: Vec<i64>) {
    bar::set_alarms(&app, ends);
}

#[tauri::command]
pub fn bar_dismiss(app: AppHandle) {
    bar::dismiss(&app);
}

#[tauri::command]
pub fn bar_visible(app: AppHandle) -> bool {
    bar::is_visible(&app)
}

/// Opens one of a fixed set of apps/pages (never an arbitrary command).
#[tauri::command]
pub fn open_target(target: String) -> Result<(), String> {
    let (program, arg): (&str, Option<&str>) = match target.as_str() {
        "spotify" => ("explorer.exe", Some("spotify:")),
        "taskmgr" => ("taskmgr.exe", None),
        "calendar" => ("explorer.exe", Some("https://calendar.google.com")),
        "sound" => ("explorer.exe", Some("ms-settings:sound")),
        "clock" => ("explorer.exe", Some("ms-clock:")),
        _ => return Err(format!("unknown target {target}")),
    };
    let mut cmd = std::process::Command::new(program);
    if let Some(a) = arg {
        cmd.arg(a);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ()).map_err(err)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------- calendar ----------

#[tauri::command]
pub async fn calendar_events(
    force: bool,
    config: State<'_, ConfigState>,
    cal: State<'_, CalState>,
    suspend: State<'_, SuspendState>,
) -> Result<CalendarData, String> {
    let urls = config.get().calendar_urls;
    if suspend.suspended() && !force {
        return Ok(CalendarData { configured: !urls.is_empty(), ..Default::default() });
    }
    let cal = cal.inner().clone();
    blocking(move || Ok(cal.get(urls, force))).await
}

#[tauri::command]
pub fn get_config(config: State<'_, ConfigState>) -> Config {
    config.get()
}

#[tauri::command]
pub fn set_config(config: Config, state: State<'_, ConfigState>) -> Result<(), String> {
    state.set(config)
}

#[tauri::command]
pub fn get_suspend(suspend: State<'_, SuspendState>) -> SuspendInfo {
    suspend.info()
}

// ---------- media ----------

#[tauri::command]
pub async fn media_get(
    known_key: String,
    suspend: State<'_, SuspendState>,
) -> Result<Option<MediaInfo>, String> {
    if suspend.suspended() {
        return Ok(None);
    }
    blocking(move || media::snapshot(&known_key)).await
}

#[tauri::command]
pub async fn media_control(action: String, value_ms: Option<i64>) -> Result<(), String> {
    blocking(move || media::control(&action, value_ms)).await
}

// ---------- system ----------

#[tauri::command]
pub async fn system_stats(
    full: Option<bool>,
    sys: State<'_, SysState>,
    config: State<'_, ConfigState>,
    suspend: State<'_, SuspendState>,
) -> Result<Option<SystemStats>, String> {
    if suspend.suspended() {
        return Ok(None);
    }
    let cfg = config.get();
    let lhm_url = cfg.lhm_enabled.then_some(cfg.lhm_url);
    let cache = sys.0.clone();
    blocking(move || {
        let mut cache = cache.lock().map_err(err)?;
        Ok(Some(cache.collect(lhm_url.as_deref(), full.unwrap_or(true))))
    })
    .await
}

// ---------- audio ----------

#[tauri::command]
pub async fn audio_snapshot(suspend: State<'_, SuspendState>) -> Result<Option<AudioSnapshot>, String> {
    if suspend.suspended() {
        return Ok(None);
    }
    blocking(|| audio::snapshot().map(Some)).await
}

#[tauri::command]
pub async fn audio_set_master(volume: f32) -> Result<(), String> {
    blocking(move || audio::set_master(volume)).await
}

#[tauri::command]
pub async fn audio_nudge_master(delta: f32) -> Result<f32, String> {
    blocking(move || audio::nudge_master(delta)).await
}

#[tauri::command]
pub async fn audio_set_master_mute(muted: bool) -> Result<(), String> {
    blocking(move || audio::set_master_mute(muted)).await
}

#[tauri::command]
pub async fn audio_set_app(pid: u32, volume: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    blocking(move || audio::set_app(pid, volume, muted)).await
}

#[tauri::command]
pub async fn audio_set_device(id: String) -> Result<(), String> {
    blocking(move || audio::set_default_device(&id)).await
}
