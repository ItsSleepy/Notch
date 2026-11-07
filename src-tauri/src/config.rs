//! User settings, stored as JSON in %APPDATA%\eu.isaac-dev.notch\config.json

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Process names that trigger a full suspend (case-insensitive, e.g. "EasyAntiCheat.exe").
    pub anticheat_processes: Vec<String>,
    pub suspend_on_fullscreen: bool,
    pub hover_expand: bool,
    /// Shrink to a minimal pill and disable hover while a game is focused (windowed/borderless).
    pub game_mode: bool,
    /// Extra game exes on top of the auto-detected game library folders.
    pub game_processes: Vec<String>,
    /// Read CPU temperature from LibreHardwareMonitor's web server.
    pub lhm_enabled: bool,
    pub lhm_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            anticheat_processes: [
                // Easy Anti-Cheat (Fortnite, Apex, Rust, Elden Ring, ...)
                "EasyAntiCheat.exe",
                "EasyAntiCheat_EOS.exe",
                // BattlEye (PUBG, R6 Siege, DayZ, Arma, ...)
                "BEService.exe",
                "BEService_x64.exe",
                // EA Javelin
                "EAAntiCheat.GameServiceLauncher.exe",
                // Riot Vanguard runs vgc.exe all the time, so match the games instead
                "VALORANT-Win64-Shipping.exe",
                "League of Legends.exe",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            suspend_on_fullscreen: true,
            hover_expand: true,
            game_mode: true,
            // Minecraft isn't installed in a game library folder.
            game_processes: ["javaw.exe", "Minecraft.Windows.exe"]
                .into_iter()
                .map(String::from)
                .collect(),
            lhm_enabled: false,
            lhm_url: "http://localhost:8085/data.json".into(),
        }
    }
}

pub struct ConfigState {
    path: PathBuf,
    inner: Mutex<Config>,
}

impl ConfigState {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("config.json");
        let config = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(config),
        }
    }

    pub fn get(&self) -> Config {
        self.inner.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn set(&self, config: Config) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())?;
        *self.inner.lock().map_err(|e| e.to_string())? = config;
        Ok(())
    }
}
