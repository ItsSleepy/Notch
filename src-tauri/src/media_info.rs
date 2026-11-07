use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// App id of the player, e.g. "Spotify.exe".
    pub source: String,
    pub playing: bool,
    pub position_ms: i64,
    pub duration_ms: i64,
    /// title|artist|album, used to only send album art when the track changes.
    pub track_key: String,
    /// data: URL, only present when the track differs from the caller's known key.
    pub art: Option<String>,
}
