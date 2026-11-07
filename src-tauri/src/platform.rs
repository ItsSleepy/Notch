//! OS checks used by the suspend watcher.

#[cfg(windows)]
#[path = "platform_win.rs"]
mod imp;

#[cfg(not(windows))]
mod imp {
    pub fn is_fullscreen_app() -> bool {
        false
    }

    pub fn any_process_running(_names: &[String]) -> bool {
        false
    }

    pub fn foreground_exe_path() -> Option<String> {
        None
    }
}

pub use imp::{any_process_running, foreground_exe_path, is_fullscreen_app};

/// Folders that only ever contain games. Matching the focused exe against these catches
/// almost every Steam/Epic/Riot/Xbox/GOG/EA/Ubisoft title without a manual list.
const GAME_LIBRARY_DIRS: &[&str] = &[
    "\\steamapps\\common\\",
    "\\epic games\\",
    "\\riot games\\",
    "\\xboxgames\\",
    "\\gog galaxy\\games\\",
    "\\ea games\\",
    "\\ubisoft game launcher\\games\\",
];

/// Whether the focused app is a game: installed in a game library, or listed by the user.
/// None when it can't tell (e.g. the notch itself has focus), so the caller keeps its last answer.
pub fn is_game_focused(extra_exes: &[String]) -> Option<bool> {
    let path = foreground_exe_path()?.to_lowercase();
    if GAME_LIBRARY_DIRS.iter().any(|dir| path.contains(dir)) {
        return Some(true);
    }
    let exe = path.rsplit('\\').next().unwrap_or(&path);
    Some(extra_exes.iter().any(|e| e.trim().eq_ignore_ascii_case(exe)))
}
