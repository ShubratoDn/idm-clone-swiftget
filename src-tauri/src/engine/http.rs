//! Segmented HTTP downloader.
//!
//! The file is split into byte ranges, each fetched over its own connection and written straight
//! into a preallocated `.swg` file. When a connection finishes its range it takes over the second
//! half of the largest range still in progress ("dynamic segmentation"), so every connection stays
//! busy until the very end.

use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::RANGE;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use super::limiter::RateLimiter;
use super::probe::probe;
use super::{error_text, set_sparse, unique_path, write_at, Outcome, RequestInfo, TaskShared};
use crate::models::Segment;

/// A range is only split when at least this much is left, so each half is at least 2 MB.
const MIN_SPLIT: u64 = 4 * 1024 * 1024;
/// Smallest range handed to a connection when the download starts.
const MIN_INITIAL_SEGMENT: u64 = 1024 * 1024;
const FLUSH_AT: usize = 256 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const SPLIT_COOLDOWN: Duration = Duration::from_secs(30);

pub struct HttpTask {
    pub client: reqwest::Client,
    pub req: RequestInfo,
    pub part_path: PathBuf,
    pub final_path: PathBuf,
    pub connections: u32,
    pub max_retries: u32,
    pub shared: Arc<TaskShared>,
    pub cancel: CancellationToken,
    pub limiter: Arc<RateLimiter>,
}

struct WorkerCtx {
    client: reqwest::Client,
    req: RequestInfo,
    path: PathBuf,
    resumable: bool,
    max_retries: u32,
    shared: Arc<TaskShared>,
    cancel: CancellationToken,
    limiter: Arc<RateLimiter>,
}

enum WorkerEnd {
    Done(usize),
    Cancelled,
}

impl HttpTask {
    pub async fn run(self) -> Result<Outcome, String> {
        let mut attempt = 0;
        let probed = loop {
            let result = tokio::select! {
                _ = self.cancel.cancelled() => return Ok(Outcome::Cancelled),
                p = probe(&self.client, &self.req) => p,
            };
            match result {
                Ok(p) => break p,
                Err(e) if attempt >= 3 || e.starts_with("Server replied HTTP 4") => return Err(e),
                Err(_) => {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_secs(2 * attempt)).await;
                }
            }
        };

        let fresh = {
            let mut st = self.shared.state.lock().unwrap();
            let changed = st.size.is_some() && st.size != probed.size
                || matches!((&st.etag, &probed.etag), (Some(a), Some(b)) if a != b);
            let fresh =
                st.segments.is_empty() || changed || !probed.resumable || !self.part_path.exists();
            st.size = probed.size;
            st.resumable = probed.resumable;
            st.etag = probed.etag.clone();
            st.last_modified = probed.last_modified.clone();
            if fresh {
                st.segments = initial_segments(probed.size, probed.resumable, self.connections);
            }
            for s in st.segments.iter_mut() {
                s.active = false;
            }
            fresh
        };

        if fresh {
            if let Some(parent) = self.part_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create folder: {e}"))?;
            }
            let f =
                File::create(&self.part_path).map_err(|e| format!("Cannot create file: {e}"))?;
            set_sparse(&f);
            if let Some(size) = probed.size {
                f.set_len(size)
                    .map_err(|e| format!("Not enough disk space: {e}"))?;
            }
        }

        let ctx = Arc::new(WorkerCtx {
            client: self.client.clone(),
            req: RequestInfo {
                url: probed.final_url.clone(),
                ..self.req.clone()
            },
            path: self.part_path.clone(),
            resumable: probed.resumable,
            max_retries: self.max_retries,
            shared: self.shared.clone(),
            cancel: self.cancel.child_token(),
            limiter: self.limiter.clone(),
        });
        // Lowered when the server refuses extra connections.
        let mut connections = if probed.resumable {
            self.connections.max(1) as usize
        } else {
            1
        };

        let mut workers: JoinSet<Result<WorkerEnd, (usize, String)>> = JoinSet::new();
        let mut failure: Option<String> = None;
        // After the server rate-limits us, stop opening new ranges for a while.
        let mut no_split_until = Instant::now();
        loop {
            if failure.is_none() && !ctx.cancel.is_cancelled() {
                let mut st = self.shared.state.lock().unwrap();
                let may_split = ctx.resumable && Instant::now() >= no_split_until;
                // Hand idle connections the unstarted ranges first, then split running ones.
                while workers.len() < connections {
                    let next = st.segments.iter().position(|s| !s.active && !s.done());
                    let idx = match next {
                        Some(i) => Some(i),
                        None if may_split => split_largest(&mut st.segments),
                        None => None,
                    };
                    let Some(idx) = idx else { break };
                    st.segments[idx].active = true;
                    workers.spawn(worker(ctx.clone(), idx));
                }
            }

            let Some(joined) = workers.join_next().await else {
                break;
            };
            match joined {
                Ok(Ok(WorkerEnd::Done(idx))) => {
                    self.shared.state.lock().unwrap().segments[idx].active = false;
                }
                Ok(Ok(WorkerEnd::Cancelled)) => {}
                Ok(Err((idx, e))) => {
                    {
                        let mut st = self.shared.state.lock().unwrap();
                        st.segments[idx].active = false;
                        merge_back(&mut st.segments, idx);
                    }
                    if e.contains("HTTP 429") || e.contains("HTTP 503") {
                        no_split_until = Instant::now() + SPLIT_COOLDOWN;
                    }
                    if workers.is_empty() {
                        // Nothing else is making progress, so this is a real failure.
                        failure = Some(e);
                    } else {
                        // Other connections still work: carry on with fewer, and let one of them
                        // pick up this range when it finishes its own.
                        connections = workers.len();
                    }
                }
                Err(e) => {
                    failure.get_or_insert(format!("Worker crashed: {e}"));
                    ctx.cancel.cancel();
                }
            }
        }

        if let Some(e) = failure {
            return Err(e);
        }
        if self.cancel.is_cancelled() {
            return Ok(Outcome::Cancelled);
        }

        {
            let mut st = self.shared.state.lock().unwrap();
            if !st.segments.iter().all(Segment::done) {
                return Err("Download ended before all data was received".into());
            }
            // Unknown-size downloads learn their size at EOF.
            if st.size.is_none() {
                st.size = Some(st.segments.iter().map(|s| s.pos - s.start).sum());
            }
        }

        let dir = self.final_path.parent().unwrap().to_path_buf();
        let name = self
            .final_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let target = unique_path(&dir, &name, |p| p.exists());
        std::fs::rename(&self.part_path, &target)
            .map_err(|e| format!("Cannot rename finished file: {e}"))?;
        Ok(Outcome::Completed(
            target.file_name().unwrap().to_string_lossy().into_owned(),
        ))
    }
}

pub fn initial_segments(size: Option<u64>, resumable: bool, connections: u32) -> Vec<Segment> {
    match size {
        Some(0) => vec![],
        Some(size) if resumable => {
            let n = (size / MIN_INITIAL_SEGMENT).clamp(1, connections.max(1) as u64);
            let part = size / n;
            (0..n)
                .map(|i| Segment::new(i * part, if i == n - 1 { size } else { (i + 1) * part }))
                .collect()
        }
        Some(size) => vec![Segment::new(0, size)],
        None => vec![Segment::new(0, u64::MAX)],
    }
}

/// Cuts the running range with the most bytes left in half and returns the new second half.
pub fn split_largest(segments: &mut Vec<Segment>) -> Option<usize> {
    let (idx, remaining) = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.active && s.end != u64::MAX)
        .map(|(i, s)| (i, s.remaining()))
        .max_by_key(|&(_, r)| r)?;
    if remaining < MIN_SPLIT {
        return None;
    }
    let mid = segments[idx].pos + remaining / 2;
    let old_end = segments[idx].end;
    segments[idx].end = mid;
    segments.push(Segment::new(mid, old_end));
    Some(segments.len() - 1)
}

/// A range whose new connection never got any data goes back to the running range it was cut
/// from. That connection's request still covers the whole original range, so it simply keeps
/// reading instead of the bytes sitting unclaimed.
pub fn merge_back(segments: &mut [Segment], idx: usize) {
    let (start, end, pos) = (segments[idx].start, segments[idx].end, segments[idx].pos);
    if pos != start {
        return;
    }
    if let Some(j) = segments.iter().position(|s| s.active && s.end == start) {
        segments[j].end = end;
        segments[idx].end = start; // now empty, counts as done
    }
}

struct ConnGuard(Arc<TaskShared>);
impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.active_conns.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Attempts for a connection that never received data while others are working.
/// A server that caps connections per client rejects the extras; give those up quickly.
const EXTRA_CONNECTION_ATTEMPTS: u32 = 3;

async fn worker(ctx: Arc<WorkerCtx>, idx: usize) -> Result<WorkerEnd, (usize, String)> {
    let file = Arc::new(
        OpenOptions::new()
            .write(true)
            .open(&ctx.path)
            .map_err(|e| (idx, format!("Cannot open file: {e}")))?,
    );
    let mut failures = 0u32;
    let mut ever_progressed = false;
    loop {
        let (pos, end) = {
            let mut st = ctx.shared.state.lock().unwrap();
            let s = &mut st.segments[idx];
            // Without range support the only way to retry is from the beginning.
            if !ctx.resumable && s.pos > s.start {
                s.pos = s.start;
            }
            (s.pos, s.end)
        };
        if pos >= end {
            return Ok(WorkerEnd::Done(idx));
        }
        match fetch_range(&ctx, &file, idx, pos, end).await {
            Ok(end) => return Ok(end),
            Err(FetchError {
                msg: e,
                progressed,
                retry_after,
            }) => {
                if progressed {
                    failures = 0;
                    ever_progressed = true;
                }
                failures += 1;
                let others_working = ctx.shared.active_conns.load(Ordering::Relaxed) > 0;
                let limit = if !ever_progressed && others_working {
                    EXTRA_CONNECTION_ATTEMPTS.min(ctx.max_retries)
                } else {
                    ctx.max_retries
                };
                // A rate-limited extra connection is not worth waiting for.
                let throttled_extra = retry_after.is_some() && !ever_progressed && others_working;
                if failures > limit || throttled_extra {
                    return Err((idx, e));
                }
                let delay = if let Some(wait) = retry_after {
                    wait
                } else if limit == EXTRA_CONNECTION_ATTEMPTS {
                    Duration::from_secs(1)
                } else {
                    Duration::from_secs((1u64 << failures.min(5)).min(30))
                };
                tokio::select! {
                    _ = ctx.cancel.cancelled() => return Ok(WorkerEnd::Cancelled),
                    _ = tokio::time::sleep(delay) => {}
                }
            }
        }
    }
}

struct FetchError {
    msg: String,
    /// Whether any bytes were saved, so a flaky but working connection is not given up on.
    progressed: bool,
    /// How long the server asked us to wait (HTTP 429/503).
    retry_after: Option<Duration>,
}

impl FetchError {
    fn new(msg: impl Into<String>, progressed: bool) -> Self {
        FetchError {
            msg: msg.into(),
            progressed,
            retry_after: None,
        }
    }
}

/// Downloads `[pos, end)` of segment `idx`.
async fn fetch_range(
    ctx: &WorkerCtx,
    file: &Arc<File>,
    idx: usize,
    pos: u64,
    end: u64,
) -> Result<WorkerEnd, FetchError> {
    let mut rb = ctx.req.get(&ctx.client, &ctx.req.url);
    if ctx.resumable {
        let range = if end == u64::MAX {
            format!("bytes={pos}-")
        } else {
            format!("bytes={}-{}", pos, end - 1)
        };
        rb = rb.header(RANGE, range);
    }
    let resp = tokio::select! {
        _ = ctx.cancel.cancelled() => return Ok(WorkerEnd::Cancelled),
        r = rb.send() => r.map_err(|e| FetchError::new(error_text(&e), false))?,
    };
    let status = resp.status().as_u16();
    let ok = if ctx.resumable {
        status == 206 || (status == 200 && pos == 0)
    } else {
        (200..300).contains(&status)
    };
    if !ok {
        let mut err = FetchError::new(format!("Server replied HTTP {status}"), false);
        if status == 429 || status == 503 {
            // Rate limited: wait as long as the server asks (Retry-After seconds), within reason.
            let secs = resp
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(5);
            err.retry_after = Some(Duration::from_secs(secs.clamp(1, 120)));
        }
        return Err(err);
    }

    ctx.shared.active_conns.fetch_add(1, Ordering::Relaxed);
    let _guard = ConnGuard(ctx.shared.clone());

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_AT + 64 * 1024);
    let mut progressed = false;
    loop {
        let next = tokio::select! {
            _ = ctx.cancel.cancelled() => {
                flush(ctx, file, idx, &mut buf).await.map_err(|e| FetchError::new(e, progressed))?;
                return Ok(WorkerEnd::Cancelled);
            }
            n = tokio::time::timeout(READ_TIMEOUT, stream.next()) => n,
        };
        match next {
            Err(_) => {
                let saved = !buf.is_empty();
                flush(ctx, file, idx, &mut buf)
                    .await
                    .map_err(|e| FetchError::new(e, progressed))?;
                return Err(FetchError::new("Connection timed out", progressed || saved));
            }
            Ok(Some(Err(e))) => {
                let saved = !buf.is_empty();
                flush(ctx, file, idx, &mut buf)
                    .await
                    .map_err(|e| FetchError::new(e, progressed))?;
                return Err(FetchError::new(error_text(&e), progressed || saved));
            }
            Ok(Some(Ok(chunk))) => {
                tokio::select! {
                    _ = ctx.cancel.cancelled() => {}
                    _ = ctx.limiter.acquire(chunk.len()) => {}
                }
                ctx.shared
                    .bytes
                    .fetch_add(chunk.len() as u64, Ordering::Relaxed);
                buf.extend_from_slice(&chunk);
                if buf.len() >= FLUSH_AT {
                    let done = flush(ctx, file, idx, &mut buf)
                        .await
                        .map_err(|e| FetchError::new(e, progressed))?;
                    progressed = true;
                    if done {
                        return Ok(WorkerEnd::Done(idx));
                    }
                }
            }
            Ok(None) => {
                let done = flush(ctx, file, idx, &mut buf)
                    .await
                    .map_err(|e| FetchError::new(e, progressed))?;
                if done {
                    return Ok(WorkerEnd::Done(idx));
                }
                let mut st = ctx.shared.state.lock().unwrap();
                let s = &mut st.segments[idx];
                if s.end == u64::MAX {
                    s.end = s.pos;
                    return Ok(WorkerEnd::Done(idx));
                }
                return Err(FetchError::new(
                    "Connection closed before the range was complete",
                    true,
                ));
            }
        }
    }
}

/// Writes buffered bytes at the segment's position, never past its (possibly shrunk) end.
/// Returns true once the segment is complete.
async fn flush(
    ctx: &WorkerCtx,
    file: &Arc<File>,
    idx: usize,
    buf: &mut Vec<u8>,
) -> Result<bool, String> {
    let (pos, end) = {
        let st = ctx.shared.state.lock().unwrap();
        let s = &st.segments[idx];
        (s.pos, s.end)
    };
    let allowed = (buf.len() as u64).min(end.saturating_sub(pos)) as usize;
    if allowed > 0 {
        let data = std::mem::take(buf);
        let f = file.clone();
        let data =
            tokio::task::spawn_blocking(move || write_at(&f, &data[..allowed], pos).map(|_| data))
                .await
                .map_err(|e| format!("Write task failed: {e}"))?
                .map_err(|e| format!("Disk write failed: {e}"))?;
        *buf = data;
    }
    buf.clear();

    let mut st = ctx.shared.state.lock().unwrap();
    let s = &mut st.segments[idx];
    // The range may have been split while we were writing; count only bytes inside it.
    s.pos = (pos + allowed as u64).min(s.end.max(pos));
    Ok(s.done())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_split() {
        let segs = initial_segments(Some(10 * 1024 * 1024), true, 8);
        assert_eq!(segs.len(), 8);
        assert_eq!(segs.last().unwrap().end, 10 * 1024 * 1024);
        assert_eq!(initial_segments(Some(100), true, 8).len(), 1);
        assert_eq!(initial_segments(None, false, 8)[0].end, u64::MAX);
    }

    #[test]
    fn failed_split_merges_back() {
        let mb = 1024 * 1024;
        let mut segs = vec![Segment::new(0, 100 * mb)];
        segs[0].active = true;
        let new = split_largest(&mut segs).unwrap();
        merge_back(&mut segs, new);
        assert_eq!(segs[0].end, 100 * mb);
        assert!(segs[new].done());
    }

    #[test]
    fn dynamic_split() {
        let mut segs = vec![Segment::new(0, 100 * 1024 * 1024)];
        segs[0].active = true;
        segs[0].pos = 20 * 1024 * 1024;
        let new = split_largest(&mut segs).unwrap();
        assert_eq!(segs[0].end, 60 * 1024 * 1024);
        assert_eq!(segs[new].start, 60 * 1024 * 1024);
        assert_eq!(segs[new].end, 100 * 1024 * 1024);
    }
}
