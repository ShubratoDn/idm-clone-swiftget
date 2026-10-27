//! Local HTTP bridge for the browser extension, bound to 127.0.0.1 only.
//!
//! Web pages cannot use it: requests carrying a web-page Origin are rejected, and `/download`
//! requires a custom `X-SwiftGet` header, which a page could only send after a CORS preflight
//! that this server never approves.

use std::io::Read;
use std::sync::Arc;

use tauri::AppHandle;

use crate::engine::probe::probe;
use crate::manager::Manager;
use crate::models::{AddRequest, Kind};
use crate::windows;

pub fn spawn(app: AppHandle, m: Arc<Manager>, port: u16) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("browser bridge could not listen on port {port}: {e}");
                return;
            }
        };
        for mut request in server.incoming_requests() {
            let header = |name: &str| {
                request
                    .headers()
                    .iter()
                    .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
                    .map(|h| h.value.as_str().to_string())
            };
            let origin_ok = header("Origin").map_or(true, |o| {
                o.starts_with("chrome-extension://")
                    || o.starts_with("moz-extension://")
                    || o.starts_with("extension://")
            });
            let marked = header("X-SwiftGet").is_some();
            let method = request.method().as_str().to_string();
            let path = request.url().split('?').next().unwrap_or("").to_string();

            let (code, body) = if !origin_ok {
                (403, r#"{"error":"forbidden"}"#.to_string())
            } else {
                match (method.as_str(), path.as_str()) {
                    ("GET", "/ping") => {
                        let body = serde_json::json!({
                            "app": "SwiftGet",
                            "version": env!("CARGO_PKG_VERSION"),
                            "extensions": m.settings().capture_extensions,
                        });
                        (200, body.to_string())
                    }
                    ("POST", "/download") if marked => {
                        let mut raw = String::new();
                        let _ = request.as_reader().take(1 << 20).read_to_string(&mut raw);
                        match serde_json::from_str::<AddRequest>(&raw) {
                            Ok(req) if !req.url.is_empty() => {
                                handle_download(&app, &m, req);
                                (200, r#"{"ok":true}"#.to_string())
                            }
                            _ => (400, r#"{"error":"bad request"}"#.to_string()),
                        }
                    }
                    _ => (404, r#"{"error":"not found"}"#.to_string()),
                }
            };
            let response = tiny_http::Response::from_string(body)
                .with_status_code(code)
                .with_header(
                    "Content-Type: application/json"
                        .parse::<tiny_http::Header>()
                        .unwrap(),
                );
            let _ = request.respond(response);
        }
    });
}

fn handle_download(app: &AppHandle, m: &Arc<Manager>, mut req: AddRequest) {
    if !m.settings().browser_auto_start {
        let token = m.stash_add(req);
        windows::open_add(app, &token);
        return;
    }
    let m = m.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(p) = probe(&m.client, &m.request_info(&req)).await {
            if req.file_name.as_deref().map_or(true, str::is_empty) {
                req.file_name = Some(p.file_name);
            }
            req.size = p.size;
            req.resumable = Some(p.resumable);
            if p.kind == Kind::Hls {
                req.kind = Some(Kind::Hls);
            }
        }
        req.start = true;
        let _ = m.add(req);
    });
}
