//! HLS (`.m3u8`) stream downloader: picks the best variant, fetches media segments in parallel,
//! decrypts AES-128 segments, then joins them into one file (remuxed to MP4 when ffmpeg is present).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use futures_util::{stream, StreamExt};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use super::limiter::RateLimiter;
use super::{error_text, unique_path, Outcome, RequestInfo, TaskShared};

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

pub struct HlsTask {
    pub client: reqwest::Client,
    pub req: RequestInfo,
    pub final_path: PathBuf,
    pub parts_dir: PathBuf,
    pub connections: u32,
    pub max_retries: u32,
    pub shared: Arc<TaskShared>,
    pub cancel: CancellationToken,
    pub limiter: Arc<RateLimiter>,
}

#[derive(Clone, Debug)]
struct Key {
    uri: String,
    iv: Option<[u8; 16]>,
}

#[derive(Clone, Debug)]
struct MediaSegment {
    url: String,
    seq: u64,
    key: Option<Key>,
}

struct Playlist {
    segments: Vec<MediaSegment>,
    init: Option<String>,
}

impl HlsTask {
    pub async fn run(self) -> Result<Outcome, String> {
        let playlist = tokio::select! {
            _ = self.cancel.cancelled() => return Ok(Outcome::Cancelled),
            p = load_playlist(&self.client, &self.req) => p?,
        };
        let total = playlist.segments.len();
        if total == 0 {
            return Err("The playlist contains no segments".into());
        }
        self.shared.hls_total.store(total as u32, Ordering::Relaxed);
        self.shared.hls_done.store(0, Ordering::Relaxed);
        self.shared.hls_bytes.store(0, Ordering::Relaxed);
        std::fs::create_dir_all(&self.parts_dir)
            .map_err(|e| format!("Cannot create folder: {e}"))?;

        let keys: Arc<AsyncMutex<HashMap<String, Vec<u8>>>> = Default::default();
        let mut jobs: Vec<(String, PathBuf, Option<Key>, u64)> = playlist
            .segments
            .iter()
            .enumerate()
            .map(|(i, s)| {
                (
                    s.url.clone(),
                    self.parts_dir.join(format!("{i:06}.seg")),
                    s.key.clone(),
                    s.seq,
                )
            })
            .collect();
        if let Some(init) = &playlist.init {
            jobs.insert(0, (init.clone(), self.parts_dir.join("init.seg"), None, 0));
        }
        let files: Vec<PathBuf> = jobs.iter().map(|j| j.1.clone()).collect();

        let this = &self;
        let mut results = stream::iter(jobs)
            .map(|(url, path, key, seq)| {
                let keys = keys.clone();
                async move { this.fetch_segment(&url, &path, key, seq, &keys).await }
            })
            .buffer_unordered(self.connections.clamp(1, 16) as usize);

        loop {
            let next = tokio::select! {
                _ = self.cancel.cancelled() => return Ok(Outcome::Cancelled),
                n = results.next() => n,
            };
            match next {
                None => break,
                Some(Ok(())) => {}
                Some(Err(e)) => return Err(e),
            }
        }
        drop(results);

        let is_fmp4 = playlist.init.is_some();
        let joined_ext = if is_fmp4 { "mp4" } else { "ts" };
        let joined = self.parts_dir.join(format!("joined.{joined_ext}"));
        let files_for_join = files.clone();
        let joined_clone = joined.clone();
        tokio::task::spawn_blocking(move || join_files(&files_for_join, &joined_clone))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Cannot join segments: {e}"))?;

        let dir = self.final_path.parent().unwrap().to_path_buf();
        let stem = self
            .final_path
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let source = if !is_fmp4 && ffmpeg_available() {
            let mp4 = self.parts_dir.join("remuxed.mp4");
            if remux(&joined, &mp4).await {
                mp4
            } else {
                joined.clone()
            }
        } else {
            joined.clone()
        };
        let ext = source.extension().unwrap().to_string_lossy().into_owned();
        let target = unique_path(&dir, &format!("{stem}.{ext}"), |p| p.exists());
        std::fs::rename(&source, &target).map_err(|e| format!("Cannot move finished file: {e}"))?;
        let _ = std::fs::remove_dir_all(&self.parts_dir);
        Ok(Outcome::Completed(
            target.file_name().unwrap().to_string_lossy().into_owned(),
        ))
    }

    async fn fetch_segment(
        &self,
        url: &str,
        path: &Path,
        key: Option<Key>,
        seq: u64,
        keys: &AsyncMutex<HashMap<String, Vec<u8>>>,
    ) -> Result<(), String> {
        if let Ok(meta) = std::fs::metadata(path) {
            self.mark_done(meta.len());
            return Ok(());
        }
        let mut failures = 0;
        loop {
            match self.try_fetch(url, path, key.as_ref(), seq, keys).await {
                Ok(len) => {
                    self.mark_done(len);
                    return Ok(());
                }
                Err(e) => {
                    failures += 1;
                    if failures > self.max_retries {
                        return Err(e);
                    }
                    tokio::time::sleep(Duration::from_secs((1u64 << failures.min(4)).min(15)))
                        .await;
                }
            }
        }
    }

    fn mark_done(&self, len: u64) {
        self.shared.hls_done.fetch_add(1, Ordering::Relaxed);
        self.shared.hls_bytes.fetch_add(len, Ordering::Relaxed);
    }

    async fn try_fetch(
        &self,
        url: &str,
        path: &Path,
        key: Option<&Key>,
        seq: u64,
        keys: &AsyncMutex<HashMap<String, Vec<u8>>>,
    ) -> Result<u64, String> {
        let resp = self
            .req
            .get(&self.client, url)
            .send()
            .await
            .map_err(|e| error_text(&e))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Segment request failed: HTTP {}",
                resp.status().as_u16()
            ));
        }
        let mut data = Vec::new();
        let mut body = resp.bytes_stream();
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(30), body.next())
            .await
            .map_err(|_| "Connection timed out".to_string())?
        {
            let chunk = chunk.map_err(|e| error_text(&e))?;
            self.limiter.acquire(chunk.len()).await;
            self.shared
                .bytes
                .fetch_add(chunk.len() as u64, Ordering::Relaxed);
            data.extend_from_slice(&chunk);
        }

        if let Some(key) = key {
            let key_bytes = {
                let mut cache = keys.lock().await;
                if let Some(k) = cache.get(&key.uri) {
                    k.clone()
                } else {
                    let k = self
                        .req
                        .get(&self.client, &key.uri)
                        .send()
                        .await
                        .map_err(|e| error_text(&e))?
                        .bytes()
                        .await
                        .map_err(|e| error_text(&e))?
                        .to_vec();
                    if k.len() != 16 {
                        return Err("Invalid AES-128 key".into());
                    }
                    cache.insert(key.uri.clone(), k.clone());
                    k
                }
            };
            let iv = key.iv.unwrap_or_else(|| {
                let mut iv = [0u8; 16];
                iv[8..].copy_from_slice(&seq.to_be_bytes());
                iv
            });
            data = Aes128CbcDec::new(key_bytes.as_slice().into(), &iv.into())
                .decrypt_padded_vec_mut::<Pkcs7>(&data)
                .map_err(|_| "Segment decryption failed".to_string())?;
        }

        let tmp = path.with_extension("tmp");
        tokio::fs::write(&tmp, &data)
            .await
            .map_err(|e| format!("Disk write failed: {e}"))?;
        tokio::fs::rename(&tmp, path)
            .await
            .map_err(|e| format!("Disk write failed: {e}"))?;
        Ok(data.len() as u64)
    }
}

async fn fetch_text(
    client: &reqwest::Client,
    req: &RequestInfo,
    url: &str,
) -> Result<(String, String), String> {
    let resp = req
        .get(client, url)
        .send()
        .await
        .map_err(|e| error_text(&e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Playlist request failed: HTTP {}",
            resp.status().as_u16()
        ));
    }
    let final_url = resp.url().to_string();
    let text = resp.text().await.map_err(|e| error_text(&e))?;
    if !text.trim_start().starts_with("#EXTM3U") {
        return Err("Not a valid HLS playlist".into());
    }
    Ok((text, final_url))
}

async fn load_playlist(client: &reqwest::Client, req: &RequestInfo) -> Result<Playlist, String> {
    let (mut text, mut base) = fetch_text(client, req, &req.url).await?;
    if text.contains("#EXT-X-STREAM-INF") {
        let variant = best_variant(&text, &base).ok_or("No playable variant in master playlist")?;
        (text, base) = fetch_text(client, req, &variant).await?;
    }
    parse_media(&text, &base)
}

fn resolve(base: &str, rel: &str) -> String {
    reqwest::Url::parse(base)
        .and_then(|b| b.join(rel))
        .map(|u| u.to_string())
        .unwrap_or_else(|_| rel.to_string())
}

/// Parses `KEY=value,KEY="quoted, value"` attribute lists.
fn parse_attrs(s: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rest = s;
    while !rest.is_empty() {
        let Some(eq) = rest.find('=') else { break };
        let key = rest[..eq].trim().to_string();
        rest = &rest[eq + 1..];
        let value;
        if let Some(stripped) = rest.strip_prefix('"') {
            let close = stripped.find('"').unwrap_or(stripped.len());
            value = stripped[..close].to_string();
            rest = stripped.get(close + 1..).unwrap_or("");
        } else {
            let comma = rest.find(',').unwrap_or(rest.len());
            value = rest[..comma].to_string();
            rest = &rest[comma..];
        }
        rest = rest.trim_start_matches(',');
        out.insert(key, value);
    }
    out
}

fn best_variant(text: &str, base: &str) -> Option<String> {
    let mut best: Option<(u64, String)> = None;
    let mut lines = text.lines().map(str::trim);
    while let Some(line) = lines.next() {
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let bw = parse_attrs(attrs)
                .get("BANDWIDTH")
                .and_then(|b| b.parse().ok())
                .unwrap_or(0);
            if let Some(uri) = lines
                .by_ref()
                .find(|l| !l.is_empty() && !l.starts_with('#'))
            {
                if best.as_ref().map_or(true, |(b, _)| bw > *b) {
                    best = Some((bw, resolve(base, uri)));
                }
            }
        }
    }
    best.map(|(_, u)| u)
}

fn parse_media(text: &str, base: &str) -> Result<Playlist, String> {
    let mut segments = Vec::new();
    let mut init = None;
    let mut key: Option<Key> = None;
    let mut seq: u64 = 0;
    for line in text.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            seq = v.trim().parse().unwrap_or(0);
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            let a = parse_attrs(attrs);
            key = match a.get("METHOD").map(String::as_str) {
                Some("NONE") | None => None,
                Some("AES-128") => {
                    let uri = a.get("URI").ok_or("Encryption key URI missing")?;
                    let iv = a.get("IV").and_then(|iv| parse_iv(iv));
                    Some(Key {
                        uri: resolve(base, uri),
                        iv,
                    })
                }
                Some(m) => return Err(format!("{m} encrypted (DRM) streams are not supported")),
            };
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            if let Some(uri) = parse_attrs(attrs).get("URI") {
                init = Some(resolve(base, uri));
            }
        } else if !line.is_empty() && !line.starts_with('#') {
            segments.push(MediaSegment {
                url: resolve(base, line),
                seq,
                key: key.clone(),
            });
            seq += 1;
        }
    }
    Ok(Playlist { segments, init })
}

fn parse_iv(s: &str) -> Option<[u8; 16]> {
    let hex = s.trim_start_matches("0x").trim_start_matches("0X");
    if hex.len() != 32 {
        return None;
    }
    let mut iv = [0u8; 16];
    for (i, byte) in iv.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(iv)
}

fn join_files(files: &[PathBuf], out: &Path) -> std::io::Result<()> {
    let mut dst = std::io::BufWriter::new(std::fs::File::create(out)?);
    for f in files {
        let mut src = std::fs::File::open(f)?;
        std::io::copy(&mut src, &mut dst)?;
    }
    std::io::Write::flush(&mut dst)
}

fn ffmpeg_command() -> std::process::Command {
    let mut cmd = std::process::Command::new("ffmpeg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn ffmpeg_available() -> bool {
    ffmpeg_command()
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

async fn remux(input: &Path, output: &Path) -> bool {
    let (input, output) = (input.to_path_buf(), output.to_path_buf());
    tokio::task::spawn_blocking(move || {
        ffmpeg_command()
            .args(["-y", "-loglevel", "error", "-i"])
            .arg(&input)
            .args(["-c", "copy", "-bsf:a", "aac_adtstoasc"])
            .arg(&output)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_picks_highest_bandwidth() {
        let m = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS=\"avc1,mp4a\"\nhigh/index.m3u8\n";
        assert_eq!(
            best_variant(m, "https://x.com/v/master.m3u8").unwrap(),
            "https://x.com/v/high/index.m3u8"
        );
    }

    #[test]
    fn media_with_key() {
        let m = "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI=\"k.bin\",IV=0x000102030405060708090a0b0c0d0e0f\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST";
        let p = parse_media(m, "https://x.com/s/list.m3u8").unwrap();
        assert_eq!(p.segments.len(), 2);
        assert_eq!(p.segments[1].seq, 8);
        assert_eq!(
            p.segments[0].key.as_ref().unwrap().uri,
            "https://x.com/s/k.bin"
        );
        assert_eq!(p.segments[0].key.as_ref().unwrap().iv.unwrap()[15], 15);
    }
}
