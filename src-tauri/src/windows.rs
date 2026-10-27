//! Secondary windows (download progress, download complete, download file info).
//! Every window loads the same frontend; the route is injected before the page runs.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

struct Spec {
    label: String,
    route: String,
    title: &'static str,
    width: f64,
    height: f64,
    on_top: bool,
}

/// Windows are created from an async task: building a webview on the thread that is
/// handling a synchronous command deadlocks on Windows.
fn open(app: &AppHandle, spec: Spec) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(win) = app.get_webview_window(&spec.label) {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
            return;
        }
        let script = format!(
            "window.__SWG_ROUTE = {};",
            serde_json::to_string(&spec.route).unwrap()
        );
        let result =
            WebviewWindowBuilder::new(&app, &spec.label, WebviewUrl::App("index.html".into()))
                .title(spec.title)
                .inner_size(spec.width, spec.height)
                .resizable(false)
                .maximizable(false)
                .minimizable(true)
                .always_on_top(spec.on_top)
                .center()
                .focused(true)
                .initialization_script(&script)
                .build();
        if let Err(e) = result {
            eprintln!("failed to open window {}: {e}", spec.label);
        }
    });
}

pub fn open_progress(app: &AppHandle, id: u64) {
    open(
        app,
        Spec {
            label: format!("progress-{id}"),
            route: format!("progress/{id}"),
            title: "Downloading",
            width: 520.0,
            height: 400.0,
            on_top: false,
        },
    );
}

pub fn close_progress(app: &AppHandle, id: u64) {
    if let Some(w) = app.get_webview_window(&format!("progress-{id}")) {
        let _ = w.close();
    }
}

pub fn open_complete(app: &AppHandle, id: u64) {
    open(
        app,
        Spec {
            label: format!("complete-{id}"),
            route: format!("complete/{id}"),
            title: "Download complete",
            width: 500.0,
            height: 290.0,
            on_top: true,
        },
    );
}

pub fn open_add(app: &AppHandle, token: &str) {
    open(
        app,
        Spec {
            label: format!("add-{token}"),
            route: format!("add/{token}"),
            title: "Download File Info",
            width: 580.0,
            height: 320.0,
            on_top: true,
        },
    );
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
