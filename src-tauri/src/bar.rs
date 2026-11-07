//! The bar: a full-width strip along the top of the primary monitor.
//!
//! With auto-hide on (the default) the window stays hidden until the mouse is pushed against
//! the very top edge of the screen for a moment, and hides again shortly after the mouse
//! leaves it — so it never sits over browser tabs. A cheap 30 ms cursor check runs on its
//! own thread; nothing else polls while the bar is hidden.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::config::ConfigState;
use crate::platform;
use crate::suspend::SuspendState;

/// Bar height in logical pixels (the frontend uses the same value).
pub const BAR_H: f64 = 32.0;
const TICK: Duration = Duration::from_millis(30);
/// How long the mouse can be away from the bar before it hides.
const HIDE_AFTER: Duration = Duration::from_millis(450);
/// Lets the slide-up animation play before the window disappears.
const HIDE_ANIM: Duration = Duration::from_millis(170);

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BarVisibility {
    pub visible: bool,
}

#[derive(Default, Clone, Copy)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl Rect {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

#[derive(Default)]
pub struct BarState {
    visible: AtomicBool,
    /// The frontend wants the bar kept open (a card was clicked open, settings are being edited).
    hold: AtomicBool,
    /// Show for a moment without the mouse (a timer finished).
    peek_until: Mutex<Option<Instant>>,
    /// Physical rect of the window and of the monitor's top edge.
    window: Mutex<Rect>,
    monitor: Mutex<Rect>,
    hwnd: Mutex<Option<isize>>,
    /// Unix ms when running timers end; the watcher pops the bar open at each one.
    alarms: Mutex<Vec<i64>>,
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main").ok_or(tauri::Error::WindowNotFound)
}

/// Native window handle, so the bar can be shown without stealing focus from the app you're in.
fn native_handle(win: &WebviewWindow) -> Option<isize> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match win.window_handle().ok()?.as_raw() {
        RawWindowHandle::Win32(h) => Some(h.hwnd.get()),
        _ => None,
    }
}

/// Spans the full width of the primary monitor, `height` logical px tall, pinned to the top.
pub fn place(app: &AppHandle, height: f64) -> tauri::Result<()> {
    let win = main_window(app)?;
    let Some(monitor) = win.primary_monitor()? else { return Ok(()) };
    let scale = monitor.scale_factor();
    let pos = *monitor.position();
    let size = *monitor.size();
    let h = (height * scale).round().max(1.0) as u32;

    win.set_size(PhysicalSize::new(size.width, h))?;
    win.set_position(PhysicalPosition::new(pos.x, pos.y))?;

    let state = app.state::<BarState>();
    *state.window.lock().unwrap() = Rect { left: pos.x, top: pos.y, right: pos.x + size.width as i32, bottom: pos.y + h as i32 };
    *state.monitor.lock().unwrap() = Rect { left: pos.x, top: pos.y, right: pos.x + size.width as i32, bottom: pos.y + size.height as i32 };
    Ok(())
}

fn set_shown(app: &AppHandle, show: bool) {
    let state = app.state::<BarState>();
    let hwnd = *state.hwnd.lock().unwrap();
    let done = hwnd.is_some_and(|h| platform::show_window(h, show));
    if !done {
        if let Ok(win) = main_window(app) {
            let _ = if show { win.show() } else { win.hide() };
        }
    }
}

fn show(app: &AppHandle) {
    let state = app.state::<BarState>();
    if state.visible.swap(true, Ordering::Relaxed) {
        return;
    }
    set_shown(app, true);
    let _ = app.emit("bar://visibility", BarVisibility { visible: true });
}

fn hide(app: &AppHandle) {
    let state = app.state::<BarState>();
    if !state.visible.swap(false, Ordering::Relaxed) {
        return;
    }
    state.hold.store(false, Ordering::Relaxed);
    let _ = app.emit("bar://visibility", BarVisibility { visible: false });
    std::thread::sleep(HIDE_ANIM);
    // Still meant to be hidden after the animation? Then really hide and drop back to bar size.
    if !state.visible.load(Ordering::Relaxed) {
        set_shown(app, false);
        let _ = place(app, BAR_H);
    }
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.state::<BarState>().visible.load(Ordering::Relaxed)
}

pub fn set_hold(app: &AppHandle, hold: bool) {
    app.state::<BarState>().hold.store(hold, Ordering::Relaxed);
}

pub fn peek(app: &AppHandle, ms: u64) {
    *app.state::<BarState>().peek_until.lock().unwrap() = Some(Instant::now() + Duration::from_millis(ms));
}

pub fn set_alarms(app: &AppHandle, ends: Vec<i64>) {
    *app.state::<BarState>().alarms.lock().unwrap() = ends;
}

/// Fires due timer alarms: shows the bar for 8 s and tells the frontend to chime.
fn fire_alarms(app: &AppHandle) {
    let state = app.state::<BarState>();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let due = {
        let mut alarms = state.alarms.lock().unwrap();
        let before = alarms.len();
        alarms.retain(|&t| t > now);
        alarms.len() != before
    };
    if due {
        peek(app, 8000);
        let _ = app.emit("bar://alarm", ());
    }
}

/// Hide now (Escape key, or the frontend asked).
pub fn dismiss(app: &AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || hide(&a));
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    place(app, BAR_H)?;
    let win = main_window(app)?;
    *app.state::<BarState>().hwnd.lock().unwrap() = native_handle(&win);
    if !app.state::<ConfigState>().get().auto_hide {
        show(app);
    }
    Ok(())
}

pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut at_top_for = Duration::ZERO;
        let mut away_for = Duration::ZERO;
        let mut config = app.state::<ConfigState>().get();
        let mut config_age = Duration::ZERO;

        loop {
            std::thread::sleep(TICK);
            config_age += TICK;
            if config_age >= Duration::from_millis(500) {
                config = app.state::<ConfigState>().get();
                config_age = Duration::ZERO;
            }

            fire_alarms(&app);
            let state = app.state::<BarState>();
            let visible = state.visible.load(Ordering::Relaxed);

            // Fullscreen app, anti-cheat game or hidden from the tray: stay out of the way.
            let suspend = app.state::<SuspendState>();
            if suspend.suspended() {
                at_top_for = Duration::ZERO;
                if visible {
                    hide(&app);
                }
                continue;
            }

            if !config.auto_hide {
                if !visible {
                    show(&app);
                }
                continue;
            }

            let peeking = {
                let mut p = state.peek_until.lock().unwrap();
                match *p {
                    Some(t) if Instant::now() < t => true,
                    Some(_) => {
                        *p = None;
                        false
                    }
                    None => false,
                }
            };

            let Some((x, y)) = platform::cursor_pos() else { continue };
            let monitor = *state.monitor.lock().unwrap();
            let at_top = y <= monitor.top && x >= monitor.left && x < monitor.right;

            if !visible {
                away_for = Duration::ZERO;
                at_top_for = if at_top { at_top_for + TICK } else { Duration::ZERO };
                // A focused game gets a longer delay so flicking the mouse up doesn't pop it open.
                let mut delay = Duration::from_millis(config.reveal_delay_ms.clamp(0, 2000));
                if suspend.info().game {
                    delay = delay * 2 + Duration::from_millis(200);
                }
                if peeking || (at_top && at_top_for >= delay) {
                    at_top_for = Duration::ZERO;
                    show(&app);
                }
                continue;
            }

            let inside = at_top || state.window.lock().unwrap().contains(x, y);
            if inside || peeking || state.hold.load(Ordering::Relaxed) {
                away_for = Duration::ZERO;
            } else {
                away_for += TICK;
                if away_for >= HIDE_AFTER {
                    away_for = Duration::ZERO;
                    hide(&app);
                }
            }
        }
    });
}
