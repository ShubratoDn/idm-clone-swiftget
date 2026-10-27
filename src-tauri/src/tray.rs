use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager as _};

use crate::manager::Manager;
use crate::windows;

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open SwiftGet", true, None::<&str>)?;
    let add = MenuItem::with_id(app, "add", "Add URL...", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Start Queue", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Queue", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &add,
            &PredefinedMenuItem::separator(app)?,
            &start,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("SwiftGet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let m = app.state::<Arc<Manager>>();
            match event.id.as_ref() {
                "show" => windows::show_main(app),
                "add" => {
                    windows::show_main(app);
                    let _ = app.emit_to("main", "menu-add-url", ());
                }
                "start" => m.inner().start_queue(),
                "stop" => m.stop_queue(),
                "quit" => {
                    m.shutdown();
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
