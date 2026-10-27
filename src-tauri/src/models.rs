use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    #[default]
    Http,
    Hls,
}

/// A byte range `[start, end)` fetched by one connection. `pos` is the next byte to write.
/// `end == u64::MAX` means the total size is unknown and the segment runs to EOF.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: u64,
    pub end: u64,
    pub pos: u64,
    #[serde(skip_deserializing)]
    pub active: bool,
}

impl Segment {
    pub fn new(start: u64, end: u64) -> Self {
        Segment {
            start,
            end,
            pos: start,
            active: false,
        }
    }
    pub fn remaining(&self) -> u64 {
        self.end.saturating_sub(self.pos)
    }
    pub fn done(&self) -> bool {
        self.pos >= self.end
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: u64,
    pub url: String,
    #[serde(default)]
    pub kind: Kind,
    pub file_name: String,
    pub save_dir: String,
    pub category: String,
    pub size: Option<u64>,
    pub downloaded: u64,
    pub status: Status,
    pub resumable: bool,
    pub connections: u32,
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub description: String,
    pub added_at: i64,
    #[serde(default)]
    pub last_try_at: Option<i64>,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub hls_total: u32,
    #[serde(default)]
    pub hls_done: u32,
}

impl Download {
    pub fn file_path(&self) -> std::path::PathBuf {
        std::path::Path::new(&self.save_dir).join(&self.file_name)
    }
    pub fn part_path(&self) -> std::path::PathBuf {
        std::path::Path::new(&self.save_dir).join(format!("{}.swg", self.file_name))
    }
    pub fn parts_dir(&self) -> std::path::PathBuf {
        std::path::Path::new(&self.save_dir).join(format!("{}.swg.parts", self.file_name))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: String,
    pub connections: u32,
    pub max_concurrent: u32,
    pub speed_limit_kbps: u64,
    pub max_retries: u32,
    pub clipboard_monitor: bool,
    pub minimize_to_tray: bool,
    pub notify_on_complete: bool,
    pub show_complete_dialog: bool,
    pub show_progress_window: bool,
    pub browser_port: u16,
    pub browser_auto_start: bool,
    pub capture_extensions: String,
    pub launch_at_startup: bool,
    pub use_category_folders: bool,
    pub user_agent: String,
}

pub const DEFAULT_EXTENSIONS: &str = "3GP 7Z AAC ACE AIF APK ARJ ASF AVI BIN BZ2 EXE GZ GZIP IMG ISO LZH M4A M4V MKV MOV MP3 MP4 MPA MPE MPEG MPG MSI MSU OGG OGV PDF PLJ PPS PPT QT R0* R1* RA RAR RM RMVB SEA SIT SITX TAR TIF TIFF WAV WEBM WMA WMV Z ZIP";

impl Default for Settings {
    fn default() -> Self {
        Settings {
            download_dir: String::new(),
            connections: 8,
            max_concurrent: 4,
            speed_limit_kbps: 0,
            max_retries: 20,
            clipboard_monitor: true,
            minimize_to_tray: true,
            notify_on_complete: false,
            show_complete_dialog: true,
            show_progress_window: true,
            browser_port: 52817,
            browser_auto_start: false,
            capture_extensions: DEFAULT_EXTENSIONS.to_string(),
            launch_at_startup: false,
            use_category_folders: true,
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum PostAction {
    #[default]
    None,
    Exit,
    Sleep,
    Shutdown,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub start_enabled: bool,
    pub start_time: String,
    pub stop_enabled: bool,
    pub stop_time: String,
    /// 0 = Sunday ... 6 = Saturday. Empty means every day.
    pub days: Vec<u8>,
    pub on_complete: PostAction,
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule {
            start_enabled: false,
            start_time: "02:00".into(),
            stop_enabled: false,
            stop_time: "07:00".into(),
            days: vec![],
            on_complete: PostAction::None,
        }
    }
}

/// Request to create a download, from the add dialog or the browser extension.
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AddRequest {
    pub url: String,
    pub file_name: Option<String>,
    pub save_dir: Option<String>,
    pub description: Option<String>,
    pub connections: Option<u32>,
    pub start: bool,
    pub referrer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
    pub kind: Option<Kind>,
    pub size: Option<u64>,
    pub resumable: Option<bool>,
}

/// Live numbers for one running download, pushed to the UI twice a second.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: u64,
    pub downloaded: u64,
    pub size: Option<u64>,
    pub speed: f64,
    pub eta: Option<f64>,
    pub connections: u32,
    pub segments: Vec<Segment>,
    pub hls_total: u32,
    pub hls_done: u32,
}
