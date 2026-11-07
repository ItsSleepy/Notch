use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    /// 0 = Windows system sounds.
    pub pid: u32,
    /// Executable file name without extension, e.g. "Spotify".
    pub exe: String,
    pub volume: f32,
    pub muted: bool,
    /// Currently making sound.
    pub active: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub master: f32,
    pub muted: bool,
    pub devices: Vec<AudioDevice>,
    pub apps: Vec<AudioApp>,
}
