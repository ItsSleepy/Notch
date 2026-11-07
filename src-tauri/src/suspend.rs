//! Hides the bar and stops all polling while a fullscreen app is focused, an anti-cheat
//! game is running, or the user hid it from the tray. Also tracks "game focused" for game mode.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::ConfigState;
use crate::platform;

#[derive(Default)]
pub struct SuspendState {
    fullscreen: AtomicBool,
    anticheat: AtomicBool,
    user_hidden: AtomicBool,
    game: AtomicBool,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SuspendInfo {
    pub fullscreen: bool,
    pub anticheat: bool,
    pub user_hidden: bool,
    /// A game is focused (not a suspend: the notch just goes minimal).
    pub game: bool,
}

impl SuspendState {
    pub fn info(&self) -> SuspendInfo {
        SuspendInfo {
            fullscreen: self.fullscreen.load(Ordering::Relaxed),
            anticheat: self.anticheat.load(Ordering::Relaxed),
            user_hidden: self.user_hidden.load(Ordering::Relaxed),
            game: self.game.load(Ordering::Relaxed),
        }
    }

    pub fn suspended(&self) -> bool {
        let i = self.info();
        i.fullscreen || i.anticheat || i.user_hidden
    }
}

/// Tell the frontend. The bar watcher (bar.rs) hides/shows the window itself.
fn apply(app: &AppHandle, _was_suspended: bool) {
    let state = app.state::<SuspendState>();
    let _ = app.emit("notch://suspend", state.info());
}

pub fn toggle_user_hidden(app: &AppHandle) {
    let state = app.state::<SuspendState>();
    let was = state.suspended();
    let hidden = !state.user_hidden.load(Ordering::Relaxed);
    state.user_hidden.store(hidden, Ordering::Relaxed);
    apply(app, was);
}

/// Cheap background check: fullscreen every second, process list every two.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        let mut last = app.state::<SuspendState>().info();

        loop {
            std::thread::sleep(Duration::from_secs(1));

            let config = app.state::<ConfigState>().get();
            let state = app.state::<SuspendState>();

            let fullscreen = config.suspend_on_fullscreen && platform::is_fullscreen_app();
            state.fullscreen.store(fullscreen, Ordering::Relaxed);

            if tick.is_multiple_of(2) {
                let anticheat = platform::any_process_running(&config.anticheat_processes);
                state.anticheat.store(anticheat, Ordering::Relaxed);
            }
            tick = tick.wrapping_add(1);

            if !config.game_mode {
                state.game.store(false, Ordering::Relaxed);
            } else if let Some(game) = platform::is_game_focused(&config.game_processes) {
                state.game.store(game, Ordering::Relaxed);
            }

            let now = state.info();
            if now != last {
                let was = last.fullscreen || last.anticheat || last.user_hidden;
                last = now;
                apply(&app, was);
            }
        }
    });
}
