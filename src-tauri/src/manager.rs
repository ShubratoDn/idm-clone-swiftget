use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager as _};
use tokio_util::sync::CancellationToken;

use crate::categories::category_for;
use crate::engine::hls::HlsTask;
use crate::engine::http::HttpTask;
use crate::engine::limiter::RateLimiter;
use crate::engine::probe::{file_name_from, sanitize_file_name};
use crate::engine::{build_client, unique_path, Outcome, RequestInfo, SharedState, TaskShared};
use crate::models::*;
use crate::windows;

pub struct Manager {
    app: AppHandle,
    inner: Mutex<Inner>,
    pub limiter: Arc<RateLimiter>,
    pub client: reqwest::Client,
    data_file: PathBuf,
}

struct Active {
    cancel: CancellationToken,
    shared: Arc<TaskShared>,
    kind: Kind,
    last_bytes: u64,
    speed: f64,
    /// Set when the user deleted a running download: Some(delete_files).
    remove_after: Option<bool>,
}

struct Inner {
    downloads: Vec<Download>,
    active: HashMap<u64, Active>,
    settings: Settings,
    schedule: Schedule,
    next_id: u64,
    pending_adds: HashMap<String, AddRequest>,
    /// True while the queue is working; used to run the "when done" action once.
    busy: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Persisted {
    next_id: u64,
    downloads: Vec<Download>,
    settings: Settings,
    schedule: Schedule,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub downloads: Vec<Download>,
    pub settings: Settings,
    pub schedule: Schedule,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Manager {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let _ = std::fs::create_dir_all(&data_dir);
        let data_file = data_dir.join("state.json");

        let mut persisted: Persisted = std::fs::read_to_string(&data_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if persisted.settings.download_dir.is_empty() {
            let dir = app
                .path()
                .download_dir()
                .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
                .unwrap_or_else(|_| PathBuf::from("."));
            persisted.settings.download_dir = dir.to_string_lossy().into_owned();
        }
        // The app was closed while these were running.
        for d in persisted.downloads.iter_mut() {
            if d.status == Status::Downloading {
                d.status = Status::Paused;
            }
        }
        let next_id = persisted.next_id.max(
            persisted
                .downloads
                .iter()
                .map(|d| d.id + 1)
                .max()
                .unwrap_or(1),
        );

        let limiter = Arc::new(RateLimiter::new(persisted.settings.speed_limit_kbps * 1024));
        Arc::new(Manager {
            app,
            inner: Mutex::new(Inner {
                downloads: persisted.downloads,
                active: HashMap::new(),
                settings: persisted.settings,
                schedule: persisted.schedule,
                next_id,
                pending_adds: HashMap::new(),
                busy: false,
            }),
            limiter,
            client: build_client(),
            data_file,
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        let inner = self.inner.lock().unwrap();
        Snapshot {
            downloads: inner.downloads.clone(),
            settings: inner.settings.clone(),
            schedule: inner.schedule.clone(),
        }
    }

    pub fn settings(&self) -> Settings {
        self.inner.lock().unwrap().settings.clone()
    }

    pub fn schedule(&self) -> Schedule {
        self.inner.lock().unwrap().schedule.clone()
    }

    pub fn get(&self, id: u64) -> Option<Download> {
        self.inner
            .lock()
            .unwrap()
            .downloads
            .iter()
            .find(|d| d.id == id)
            .cloned()
    }

    pub fn save(&self) {
        let json = {
            let inner = self.inner.lock().unwrap();
            let p = Persisted {
                next_id: inner.next_id,
                downloads: inner.downloads.clone(),
                settings: inner.settings.clone(),
                schedule: inner.schedule.clone(),
            };
            serde_json::to_string_pretty(&p).unwrap()
        };
        let tmp = self.data_file.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.data_file);
        }
    }

    /// Category and target folder for a file name, following the user's category-folder setting.
    pub fn suggest(&self, file_name: &str) -> (String, String) {
        let s = self.settings();
        let category = category_for(file_name).to_string();
        let dir = if s.use_category_folders && category != "General" {
            Path::new(&s.download_dir).join(&category)
        } else {
            PathBuf::from(&s.download_dir)
        };
        (category, dir.to_string_lossy().into_owned())
    }

    pub fn request_info(&self, req: &AddRequest) -> RequestInfo {
        RequestInfo {
            url: req.url.clone(),
            referrer: req.referrer.clone(),
            cookies: req.cookies.clone(),
            user_agent: req
                .user_agent
                .clone()
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| self.settings().user_agent),
        }
    }

    pub fn stash_add(&self, req: AddRequest) -> String {
        let token = format!("{:x}", now_ms() ^ (rand_bits() as i64));
        self.inner
            .lock()
            .unwrap()
            .pending_adds
            .insert(token.clone(), req);
        token
    }

    pub fn take_pending(&self, token: &str) -> Option<AddRequest> {
        self.inner.lock().unwrap().pending_adds.remove(token)
    }

    pub fn add(self: &Arc<Self>, req: AddRequest) -> Result<u64, String> {
        let url = req.url.trim().to_string();
        let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Only http:// and https:// addresses are supported".into());
        }
        let raw_name = req
            .file_name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| file_name_from(&Default::default(), &url, None));
        let file_name = sanitize_file_name(&raw_name);
        let (category, suggested_dir) = self.suggest(&file_name);
        let save_dir = req
            .save_dir
            .clone()
            .filter(|d| !d.trim().is_empty())
            .unwrap_or(suggested_dir);
        let settings = self.settings();

        let id = {
            let mut inner = self.inner.lock().unwrap();
            let taken: Vec<String> = inner
                .downloads
                .iter()
                .filter(|d| d.status != Status::Completed)
                .map(|d| d.file_path().to_string_lossy().to_lowercase())
                .collect();
            let path = unique_path(Path::new(&save_dir), &file_name, |p| {
                p.exists()
                    || Path::new(&format!("{}.swg", p.display())).exists()
                    || taken.contains(&p.to_string_lossy().to_lowercase())
            });
            let id = inner.next_id;
            inner.next_id += 1;
            let d = Download {
                id,
                url,
                kind: req.kind.unwrap_or_default(),
                file_name: path.file_name().unwrap().to_string_lossy().into_owned(),
                save_dir,
                category,
                size: req.size,
                downloaded: 0,
                status: if req.start {
                    Status::Queued
                } else {
                    Status::Paused
                },
                resumable: req.resumable.unwrap_or(false),
                connections: req.connections.unwrap_or(settings.connections).clamp(1, 32),
                segments: vec![],
                referrer: req.referrer.clone(),
                cookies: req.cookies.clone(),
                user_agent: req.user_agent.clone(),
                etag: None,
                last_modified: None,
                error: None,
                description: req.description.clone().unwrap_or_default(),
                added_at: now_ms(),
                last_try_at: None,
                completed_at: None,
                hls_total: 0,
                hls_done: 0,
            };
            let _ = self.app.emit("download-updated", &d);
            inner.downloads.push(d);
            id
        };
        self.save();
        self.pump();
        if req.start && settings.show_progress_window {
            windows::open_progress(&self.app, id);
        }
        Ok(id)
    }

    pub fn start(self: &Arc<Self>, ids: &[u64]) {
        {
            let mut inner = self.inner.lock().unwrap();
            for d in inner.downloads.iter_mut().filter(|d| ids.contains(&d.id)) {
                if matches!(d.status, Status::Paused | Status::Failed) {
                    d.status = Status::Queued;
                    d.error = None;
                    let _ = self.app.emit("download-updated", &*d);
                }
            }
        }
        self.pump();
    }

    pub fn pause(&self, ids: &[u64]) {
        let mut inner = self.inner.lock().unwrap();
        let inner = &mut *inner;
        for id in ids {
            if let Some(a) = inner.active.get(id) {
                a.cancel.cancel();
            } else if let Some(d) = inner
                .downloads
                .iter_mut()
                .find(|d| d.id == *id && d.status == Status::Queued)
            {
                d.status = Status::Paused;
                let _ = self.app.emit("download-updated", &*d);
            }
        }
    }

    /// "Start Queue": everything unfinished starts, limited by the concurrent-downloads setting.
    pub fn start_queue(self: &Arc<Self>) {
        let ids: Vec<u64> = {
            let inner = self.inner.lock().unwrap();
            inner
                .downloads
                .iter()
                .filter(|d| matches!(d.status, Status::Paused | Status::Failed))
                .map(|d| d.id)
                .collect()
        };
        self.start(&ids);
    }

    pub fn stop_queue(&self) {
        let ids: Vec<u64> = {
            let inner = self.inner.lock().unwrap();
            inner
                .downloads
                .iter()
                .filter(|d| matches!(d.status, Status::Queued | Status::Downloading))
                .map(|d| d.id)
                .collect()
        };
        self.pause(&ids);
    }

    pub fn remove(&self, ids: &[u64], delete_files: bool) {
        let mut to_delete = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            for id in ids {
                if let Some(a) = inner.active.get_mut(id) {
                    // Files are still open; finish() deletes them once the task has stopped.
                    a.remove_after = Some(delete_files);
                    a.cancel.cancel();
                    continue;
                }
                if let Some(pos) = inner.downloads.iter().position(|d| d.id == *id) {
                    let d = inner.downloads.remove(pos);
                    let _ = self.app.emit("download-removed", d.id);
                    to_delete.push(d);
                }
            }
        }
        for d in to_delete {
            delete_download_files(&d, delete_files);
        }
        self.save();
    }

    pub fn redownload(self: &Arc<Self>, id: u64) {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.active.contains_key(&id) {
                return;
            }
            let Some(d) = inner.downloads.iter_mut().find(|d| d.id == id) else {
                return;
            };
            delete_download_files(d, d.status != Status::Completed);
            d.segments.clear();
            d.downloaded = 0;
            d.size = None;
            d.completed_at = None;
            d.error = None;
            d.hls_done = 0;
            d.status = Status::Queued;
            let _ = self.app.emit("download-updated", &*d);
        }
        self.pump();
    }

    pub fn set_settings(self: &Arc<Self>, settings: Settings) {
        self.limiter.set_rate(settings.speed_limit_kbps * 1024);
        crate::apply_autostart(&self.app, settings.launch_at_startup);
        self.inner.lock().unwrap().settings = settings.clone();
        let _ = self.app.emit("settings-changed", &settings);
        self.save();
        self.pump();
    }

    pub fn set_schedule(&self, schedule: Schedule) {
        self.inner.lock().unwrap().schedule = schedule.clone();
        let _ = self.app.emit("schedule-changed", &schedule);
        self.save();
    }

    /// Starts queued downloads until the concurrent-downloads limit is reached.
    pub fn pump(self: &Arc<Self>) {
        let mut inner = self.inner.lock().unwrap();
        let max = inner.settings.max_concurrent.max(1) as usize;
        while inner.active.len() < max {
            let Some(idx) = inner
                .downloads
                .iter()
                .position(|d| d.status == Status::Queued)
            else {
                break;
            };
            self.spawn_locked(&mut inner, idx);
        }
    }

    fn spawn_locked(self: &Arc<Self>, inner: &mut Inner, idx: usize) {
        let settings = inner.settings.clone();
        let d = &mut inner.downloads[idx];
        d.status = Status::Downloading;
        d.error = None;
        d.last_try_at = Some(now_ms());
        let _ = self.app.emit("download-updated", &*d);

        let shared = Arc::new(TaskShared {
            state: Mutex::new(SharedState {
                segments: d.segments.clone(),
                size: d.size,
                resumable: d.resumable,
                etag: d.etag.clone(),
                last_modified: d.last_modified.clone(),
            }),
            ..Default::default()
        });
        let cancel = CancellationToken::new();
        let req = RequestInfo {
            url: d.url.clone(),
            referrer: d.referrer.clone(),
            cookies: d.cookies.clone(),
            user_agent: d
                .user_agent
                .clone()
                .filter(|u| !u.is_empty())
                .unwrap_or(settings.user_agent.clone()),
        };
        let task: Pin<Box<dyn Future<Output = Result<Outcome, String>> + Send>> = match d.kind {
            Kind::Http => Box::pin(
                HttpTask {
                    client: self.client.clone(),
                    req,
                    part_path: d.part_path(),
                    final_path: d.file_path(),
                    connections: d.connections,
                    max_retries: settings.max_retries,
                    shared: shared.clone(),
                    cancel: cancel.clone(),
                    limiter: self.limiter.clone(),
                }
                .run(),
            ),
            Kind::Hls => Box::pin(
                HlsTask {
                    client: self.client.clone(),
                    req,
                    final_path: d.file_path(),
                    parts_dir: d.parts_dir(),
                    connections: d.connections,
                    max_retries: settings.max_retries,
                    shared: shared.clone(),
                    cancel: cancel.clone(),
                    limiter: self.limiter.clone(),
                }
                .run(),
            ),
        };
        let id = d.id;
        let kind = d.kind;
        inner.active.insert(
            id,
            Active {
                cancel,
                shared,
                kind,
                last_bytes: 0,
                speed: 0.0,
                remove_after: None,
            },
        );
        inner.busy = true;

        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = task.await;
            me.finish(id, result);
        });
    }

    fn finish(self: &Arc<Self>, id: u64, result: Result<Outcome, String>) {
        let mut removed: Option<(Download, bool)> = None;
        let mut completed: Option<Download> = None;
        let post_action;
        {
            let mut inner = self.inner.lock().unwrap();
            let Some(active) = inner.active.remove(&id) else {
                return;
            };
            let Some(pos) = inner.downloads.iter().position(|d| d.id == id) else {
                return;
            };

            if let Some(delete_files) = active.remove_after {
                let d = inner.downloads.remove(pos);
                let _ = self.app.emit("download-removed", id);
                removed = Some((d, delete_files));
            } else {
                let d = &mut inner.downloads[pos];
                sync_from_shared(d, &active);
                match result {
                    Ok(Outcome::Completed(name)) => {
                        d.file_name = name;
                        d.status = Status::Completed;
                        d.completed_at = Some(now_ms());
                        if let Some(size) = d.size {
                            d.downloaded = size;
                        } else {
                            d.size = Some(d.downloaded);
                        }
                        d.segments.clear();
                        completed = Some(d.clone());
                    }
                    Ok(Outcome::Cancelled) => d.status = Status::Paused,
                    Err(e) => {
                        d.status = Status::Failed;
                        d.error = Some(e);
                    }
                }
                let _ = self.app.emit("download-updated", &*d);
            }

            let idle = inner.active.is_empty()
                && !inner.downloads.iter().any(|d| d.status == Status::Queued);
            post_action = if idle && inner.busy && completed.is_some() {
                inner.busy = false;
                Some(inner.schedule.on_complete)
            } else {
                if idle {
                    inner.busy = false;
                }
                None
            };
        }

        if let Some((d, delete_files)) = removed {
            delete_download_files(&d, delete_files);
        }
        if let Some(d) = &completed {
            let settings = self.settings();
            windows::close_progress(&self.app, id);
            if settings.show_complete_dialog {
                windows::open_complete(&self.app, id);
            }
            if settings.notify_on_complete {
                use tauri_plugin_notification::NotificationExt;
                let _ = self
                    .app
                    .notification()
                    .builder()
                    .title("Download complete")
                    .body(&d.file_name)
                    .show();
            }
        }
        self.save();
        self.pump();
        if let Some(action) = post_action.filter(|a| *a != PostAction::None) {
            crate::scheduler::run_post_action(&self.app, action);
        }
    }

    /// Samples live progress of running downloads. Called by the reporter every `dt` seconds.
    pub fn tick(&self, dt: f64) -> Vec<Progress> {
        let mut inner = self.inner.lock().unwrap();
        let inner = &mut *inner;
        let mut out = Vec::new();
        for (id, a) in inner.active.iter_mut() {
            let bytes = a.shared.bytes.load(Ordering::Relaxed);
            let instant = (bytes - a.last_bytes) as f64 / dt;
            a.last_bytes = bytes;
            a.speed = if a.speed == 0.0 {
                instant
            } else {
                a.speed * 0.6 + instant * 0.4
            };
            let Some(d) = inner.downloads.iter_mut().find(|d| d.id == *id) else {
                continue;
            };
            sync_from_shared(d, a);
            let eta = match (d.size, d.kind) {
                (Some(size), _) if a.speed > 1.0 => {
                    Some(size.saturating_sub(d.downloaded) as f64 / a.speed)
                }
                (None, Kind::Hls) if a.speed > 1.0 && d.hls_done > 0 => {
                    let per_seg = d.downloaded as f64 / d.hls_done as f64;
                    Some((d.hls_total - d.hls_done) as f64 * per_seg / a.speed)
                }
                _ => None,
            };
            out.push(Progress {
                id: *id,
                downloaded: d.downloaded,
                size: d.size,
                speed: a.speed,
                eta,
                connections: a.shared.active_conns.load(Ordering::Relaxed),
                segments: d.segments.clone(),
                hls_total: d.hls_total,
                hls_done: d.hls_done,
            });
        }
        out
    }

    pub fn has_active(&self) -> bool {
        !self.inner.lock().unwrap().active.is_empty()
    }

    /// Stops everything and saves resume data. Called on exit.
    pub fn shutdown(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            let inner = &mut *inner;
            for (id, a) in inner.active.iter() {
                a.cancel.cancel();
                if let Some(d) = inner.downloads.iter_mut().find(|d| d.id == *id) {
                    sync_from_shared(d, a);
                    d.status = Status::Paused;
                }
            }
        }
        self.save();
    }
}

fn sync_from_shared(d: &mut Download, a: &Active) {
    let st = a.shared.state.lock().unwrap();
    d.segments = st.segments.clone();
    d.size = st.size;
    d.resumable = st.resumable;
    d.etag = st.etag.clone();
    d.last_modified = st.last_modified.clone();
    drop(st);
    d.downloaded = a.shared.downloaded(a.kind == Kind::Hls);
    if a.kind == Kind::Hls {
        d.hls_total = a.shared.hls_total.load(Ordering::Relaxed);
        d.hls_done = a.shared.hls_done.load(Ordering::Relaxed);
    }
}

fn delete_download_files(d: &Download, delete_files: bool) {
    // Unfinished data is useless without its record, so it always goes.
    let _ = std::fs::remove_file(d.part_path());
    let _ = std::fs::remove_dir_all(d.parts_dir());
    if delete_files && d.status == Status::Completed {
        let _ = std::fs::remove_file(d.file_path());
    }
}

fn rand_bits() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(now_ms() as u64);
    h.finish()
}
