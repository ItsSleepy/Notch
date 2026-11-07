//! Master volume, per-app volume mixer and output device switching (Windows Core Audio).

pub use crate::audio_types::AudioSnapshot;

#[cfg(windows)]
#[path = "audio_win.rs"]
mod imp;

#[cfg(not(windows))]
mod imp {
    use super::AudioSnapshot;

    const NA: &str = "audio controls are only available on Windows";

    pub fn snapshot() -> Result<AudioSnapshot, String> {
        Err(NA.into())
    }
    pub fn set_master(_volume: f32) -> Result<(), String> {
        Err(NA.into())
    }
    pub fn nudge_master(_delta: f32) -> Result<f32, String> {
        Err(NA.into())
    }
    pub fn set_master_mute(_muted: bool) -> Result<(), String> {
        Err(NA.into())
    }
    pub fn set_app(_pid: u32, _volume: Option<f32>, _muted: Option<bool>) -> Result<(), String> {
        Err(NA.into())
    }
    pub fn set_default_device(_id: &str) -> Result<(), String> {
        Err(NA.into())
    }
}

pub use imp::{nudge_master, set_app, set_default_device, set_master, set_master_mute, snapshot};
