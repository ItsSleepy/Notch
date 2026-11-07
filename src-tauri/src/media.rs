//! Now playing + transport controls via the Windows media session (SMTC).
//! Works with Spotify and any other app that shows up in the Windows volume flyout.

pub use crate::media_info::MediaInfo;

#[cfg(windows)]
#[path = "smtc.rs"]
mod imp;

#[cfg(not(windows))]
mod imp {
    use super::MediaInfo;

    pub fn snapshot(_known_key: &str) -> Result<Option<MediaInfo>, String> {
        Ok(None)
    }

    pub fn control(_action: &str, _value_ms: Option<i64>) -> Result<(), String> {
        Err("media controls are only available on Windows".into())
    }
}

pub use imp::{control, snapshot};
