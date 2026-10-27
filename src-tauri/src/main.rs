#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod categories;
mod commands;
mod engine;
mod manager;
mod models;
mod scheduler;
mod server;
mod tray;
mod windows;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager as _, RunEvent, WindowEvent};

use manager::Manager;

pub fn apply_autostart(app: &tauri::AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let _ = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
}

fn format_speed(bps: f64) -> String {
    if bps >= 1024.0 * 1024.0 {
        format!("{:.2} MB/s", bps / 1024.0 / 1024.0)
    } else {
        format!("{:.1} KB/s", bps / 1024.0)
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let m = Manager::new(handle.clone());
            app.manage(m.clone());

            tray::create(app)?;
            server::spawn(handle.clone(), m.clone(), m.settings().browser_port);
            scheduler::spawn(m.clone());

            // Live progress for every window, twice a second.
            let reporter = m.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(500));
                let mut ticks = 0u32;
                let mut was_active = false;
                loop {
                    interval.tick().await;
                    let progress = reporter.tick(0.5);
                    let tray = handle.tray_by_id("main");
                    if !progress.is_empty() {
                        let _ = handle.emit("progress", &progress);
                        ticks += 1;
                        if ticks % 10 == 0 {
                            reporter.save();
                        }
                        let speed: f64 = progress.iter().map(|p| p.speed).sum();
                        if let Some(t) = &tray {
                            let tip = format!(
                                "SwiftGet - {} active, {}",
                                progress.len(),
                                format_speed(speed)
                            );
                            let _ = t.set_tooltip(Some(tip));
                        }
                        was_active = true;
                    } else if was_active {
                        was_active = false;
                        if let Some(t) = &tray {
                            let _ = t.set_tooltip(Some("SwiftGet"));
                        }
                    }
                }
            });

            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            m.pump();
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let m = window.state::<Arc<Manager>>();
                if m.settings().minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    m.shutdown();
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_download,
            commands::take_pending_add,
            commands::probe_url,
            commands::suggest_folder,
            commands::add_download,
            commands::start_downloads,
            commands::pause_downloads,
            commands::remove_downloads,
            commands::redownload,
            commands::start_queue,
            commands::stop_queue,
            commands::open_file,
            commands::open_folder,
            commands::open_progress_window,
            commands::open_add_window,
            commands::save_settings,
            commands::save_schedule,
            commands::set_speed_limit,
            commands::clipboard_url,
            commands::show_main_window,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SwiftGet");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(m) = app.try_state::<Arc<Manager>>() {
                if m.has_active() {
                    m.shutdown();
                } else {
                    m.save();
                }
            }
        }
    });
}
