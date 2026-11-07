//! Windows implementation of media.rs using GlobalSystemMediaTransportControlsSessionManager.

use std::cell::Cell;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use crate::media_info::MediaInfo;

/// 100-nanosecond ticks per millisecond (WinRT TimeSpan unit).
const TICKS_PER_MS: i64 = 10_000;
/// Skip absurdly large thumbnails.
const MAX_ART_BYTES: u32 = 4 * 1024 * 1024;

thread_local! {
    static RO_INIT: Cell<bool> = const { Cell::new(false) };
}

/// Worker threads join the multithreaded apartment once, so blocking `.get()` calls are safe.
fn ensure_winrt() {
    RO_INIT.with(|done| {
        if !done.get() {
            // S_FALSE / RPC_E_CHANGED_MODE are fine: the thread is already initialised.
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
            done.set(true);
        }
    });
}

fn err(e: windows::core::Error) -> String {
    e.message().to_string()
}

fn current_session() -> Result<Option<Session>, String> {
    ensure_winrt();
    let manager = SessionManager::RequestAsync().map_err(err)?.get().map_err(err)?;
    // Errors here just mean nothing is playing.
    Ok(manager.GetCurrentSession().ok())
}

pub fn snapshot(known_key: &str) -> Result<Option<MediaInfo>, String> {
    let Some(session) = current_session()? else {
        return Ok(None);
    };

    let props = session
        .TryGetMediaPropertiesAsync()
        .map_err(err)?
        .get()
        .map_err(err)?;

    let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
    let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
    let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
    if title.is_empty() && artist.is_empty() {
        return Ok(None);
    }

    let source = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();

    let playing = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == PlaybackStatus::Playing)
        .unwrap_or(false);

    let (position_ms, duration_ms) = match session.GetTimelineProperties() {
        Ok(t) => {
            let ms = |r: windows::core::Result<windows::Foundation::TimeSpan>| {
                r.map(|ts| ts.Duration / TICKS_PER_MS).unwrap_or(0)
            };
            let start = ms(t.StartTime());
            let end = ms(t.EndTime());
            let pos = ms(t.Position());
            ((pos - start).max(0), (end - start).max(0))
        }
        Err(_) => (0, 0),
    };

    let track_key = format!("{title}|{artist}|{album}");
    let art = if track_key != known_key {
        read_thumbnail(&props)
    } else {
        None
    };

    Ok(Some(MediaInfo {
        title,
        artist,
        album,
        source,
        playing,
        position_ms,
        duration_ms,
        track_key,
        art,
    }))
}

fn read_thumbnail(props: &MediaProperties) -> Option<String> {
    let reference = props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.get().ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok()?;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }

    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;

    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        "image/jpeg"
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}

pub fn control(action: &str, value_ms: Option<i64>) -> Result<(), String> {
    let Some(session) = current_session()? else {
        return Err("nothing is playing".into());
    };

    let ok = match action {
        "playPause" => session.TryTogglePlayPauseAsync().map_err(err)?.get(),
        "next" => session.TrySkipNextAsync().map_err(err)?.get(),
        "previous" => session.TrySkipPreviousAsync().map_err(err)?.get(),
        "seek" => {
            let ms = value_ms.ok_or("seek needs a position")?.max(0);
            session
                .TryChangePlaybackPositionAsync(ms * TICKS_PER_MS)
                .map_err(err)?
                .get()
        }
        other => return Err(format!("unknown media action: {other}")),
    }
    .map_err(err)?;

    if ok {
        Ok(())
    } else {
        Err(format!("the player refused '{action}'"))
    }
}
