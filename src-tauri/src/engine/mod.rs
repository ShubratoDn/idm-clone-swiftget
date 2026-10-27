pub mod hls;
pub mod http;
pub mod limiter;
pub mod probe;
#[cfg(test)]
mod tests;

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::{COOKIE, REFERER, USER_AGENT};

use crate::models::Segment;

pub enum Outcome {
    /// Finished; carries the final file name (it may differ if the name was taken or remuxed).
    Completed(String),
    Cancelled,
}

/// HTTP/1.1 only: with HTTP/2 every segment would be multiplexed over one TCP connection,
/// which defeats the point of downloading with several connections.
pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(32)
        .tcp_nodelay(true)
        .build()
        .expect("failed to build HTTP client")
}

/// Everything needed to repeat the browser's request for a file.
#[derive(Clone, Debug, Default)]
pub struct RequestInfo {
    pub url: String,
    pub referrer: Option<String>,
    pub cookies: Option<String>,
    pub user_agent: String,
}

impl RequestInfo {
    pub fn get(&self, client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
        let mut rb = client.get(url).header(USER_AGENT, &self.user_agent);
        if let Some(r) = self.referrer.as_deref().filter(|r| !r.is_empty()) {
            rb = rb.header(REFERER, r);
        }
        if let Some(c) = self.cookies.as_deref().filter(|c| !c.is_empty()) {
            rb = rb.header(COOKIE, c);
        }
        rb
    }
}

/// State shared between a running download task, its workers and the progress reporter.
#[derive(Default)]
pub struct TaskShared {
    pub state: Mutex<SharedState>,
    /// Total bytes received, used for speed calculation.
    pub bytes: AtomicU64,
    pub active_conns: AtomicU32,
    pub hls_total: AtomicU32,
    pub hls_done: AtomicU32,
    pub hls_bytes: AtomicU64,
}

#[derive(Default, Clone)]
pub struct SharedState {
    pub segments: Vec<Segment>,
    pub size: Option<u64>,
    pub resumable: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl TaskShared {
    pub fn downloaded(&self, is_hls: bool) -> u64 {
        if is_hls {
            return self.hls_bytes.load(std::sync::atomic::Ordering::Relaxed);
        }
        let st = self.state.lock().unwrap();
        st.segments.iter().map(|s| s.pos - s.start).sum()
    }
}

/// Positional write that does not move a shared cursor, so each worker can write its own range.
pub fn write_at(file: &File, mut buf: &[u8], mut offset: u64) -> std::io::Result<()> {
    while !buf.is_empty() {
        #[cfg(windows)]
        let n = std::os::windows::fs::FileExt::seek_write(file, buf, offset)?;
        #[cfg(unix)]
        let n = std::os::unix::fs::FileExt::write_at(file, buf, offset)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "write returned 0",
            ));
        }
        buf = &buf[n..];
        offset += n as u64;
    }
    Ok(())
}

/// Marks the file sparse on NTFS. Without this, writing a segment far into a preallocated file makes
/// Windows zero-fill everything before it first, which stalls large downloads.
pub fn set_sparse(file: &File) {
    #[cfg(windows)]
    unsafe {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
        use windows_sys::Win32::System::IO::DeviceIoControl;
        let mut returned = 0u32;
        DeviceIoControl(
            file.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        );
    }
    #[cfg(not(windows))]
    let _ = file;
}

/// Returns `dir/name`, or `dir/name (1).ext` etc. if that path is taken.
pub fn unique_path(dir: &Path, name: &str, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let candidate = dir.join(name);
    if !taken(&candidate) {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !taken(p))
        .unwrap()
}

pub fn error_text(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "Connection timed out".into()
    } else if e.is_connect() {
        "Could not connect to server".into()
    } else {
        let mut msg = e.to_string();
        let mut src = std::error::Error::source(e);
        while let Some(s) = src {
            msg = format!("{msg}: {s}");
            src = s.source();
        }
        msg
    }
}
