use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::engine::probe::{probe, ProbeResult};
use crate::manager::{Manager, Snapshot};
use crate::models::*;
use crate::windows;

type M<'a> = State<'a, Arc<Manager>>;

#[tauri::command]
pub fn get_snapshot(m: M) -> Snapshot {
    m.snapshot()
}

#[tauri::command]
pub fn get_download(m: M, id: u64) -> Option<Download> {
    m.get(id)
}

#[tauri::command]
pub fn take_pending_add(m: M, token: String) -> Option<AddRequest> {
    m.take_pending(&token)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    #[serde(flatten)]
    pub probe: ProbeResult,
    pub category: String,
    pub save_dir: String,
}

#[tauri::command]
pub async fn probe_url(m: M<'_>, req: AddRequest) -> Result<ProbeInfo, String> {
    let info = m.request_info(&req);
    let probe = probe(&m.client, &info).await?;
    let (category, save_dir) = m.suggest(&probe.file_name);
    Ok(ProbeInfo {
        probe,
        category,
        save_dir,
    })
}

#[tauri::command]
pub fn suggest_folder(m: M, file_name: String) -> (String, String) {
    m.suggest(&file_name)
}

#[tauri::command]
pub async fn add_download(m: M<'_>, req: AddRequest) -> Result<u64, String> {
    m.inner().add(req)
}

#[tauri::command]
pub fn start_downloads(m: M, ids: Vec<u64>) {
    m.inner().start(&ids);
}

#[tauri::command]
pub fn pause_downloads(m: M, ids: Vec<u64>) {
    m.pause(&ids);
}

#[tauri::command]
pub fn remove_downloads(m: M, ids: Vec<u64>, delete_files: bool) {
    m.remove(&ids, delete_files);
}

#[tauri::command]
pub fn redownload(m: M, id: u64) {
    m.inner().redownload(id);
}

#[tauri::command]
pub fn start_queue(m: M) {
    m.inner().start_queue();
}

#[tauri::command]
pub fn stop_queue(m: M) {
    m.stop_queue();
}

#[tauri::command]
pub fn open_file(app: AppHandle, m: M, id: u64) -> Result<(), String> {
    let d = m.get(id).ok_or("Download not found")?;
    app.opener()
        .open_path(d.file_path().to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_folder(app: AppHandle, m: M, id: u64) -> Result<(), String> {
    let d = m.get(id).ok_or("Download not found")?;
    let file = d.file_path();
    if d.status == Status::Completed && file.exists() {
        app.opener()
            .reveal_item_in_dir(&file)
            .map_err(|e| e.to_string())
    } else {
        let _ = std::fs::create_dir_all(&d.save_dir);
        app.opener()
            .open_path(&d.save_dir, None::<&str>)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn open_progress_window(app: AppHandle, id: u64) {
    windows::open_progress(&app, id);
}

#[tauri::command]
pub async fn open_add_window(app: AppHandle, m: M<'_>, url: String) -> Result<(), String> {
    let token = m.stash_add(AddRequest {
        url,
        ..Default::default()
    });
    windows::open_add(&app, &token);
    Ok(())
}

#[tauri::command]
pub fn save_settings(m: M, settings: Settings) {
    m.inner().set_settings(settings);
}

#[tauri::command]
pub fn save_schedule(m: M, schedule: Schedule) {
    m.set_schedule(schedule);
}

#[tauri::command]
pub fn set_speed_limit(m: M, kbps: u64) {
    let mut s = m.settings();
    s.speed_limit_kbps = kbps;
    m.inner().set_settings(s);
}

/// The clipboard text if it is a download address, used to prefill "Add URL".
#[tauri::command]
pub fn clipboard_url(m: M) -> Option<String> {
    if !m.settings().clipboard_monitor {
        return None;
    }
    let text = arboard::Clipboard::new().ok()?.get_text().ok()?;
    let text = text.trim();
    let ok = (text.starts_with("http://") || text.starts_with("https://"))
        && !text.contains(char::is_whitespace);
    ok.then(|| text.to_string())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    windows::show_main(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle, m: M) {
    m.shutdown();
    app.exit(0);
}
