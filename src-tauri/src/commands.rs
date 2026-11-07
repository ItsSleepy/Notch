//! Everything the frontend can call. Blocking work runs on a worker thread so the UI never stalls.

use tauri::{AppHandle, State};

use crate::audio::{self, AudioSnapshot};
use crate::config::{Config, ConfigState};
use crate::media::{self, MediaInfo};
use crate::suspend::{SuspendInfo, SuspendState};
use crate::system::{SysState, SystemStats};
use crate::window;

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

#[tauri::command]
pub fn resize_notch(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    window::resize(&app, width, height).map_err(err)
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
        Ok(Some(cache.collect(lhm_url.as_deref())))
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
