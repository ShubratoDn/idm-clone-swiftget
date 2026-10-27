use std::sync::Arc;
use std::time::Duration;

use chrono::{Datelike, Local};
use tauri::{AppHandle, Manager as _};

use crate::manager::Manager;
use crate::models::PostAction;

/// Starts and stops the queue at the times set in the Scheduler dialog.
pub fn spawn(m: Arc<Manager>) {
    tauri::async_runtime::spawn(async move {
        let mut last_fired = String::new();
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let s = m.schedule();
            let now = Local::now();
            let minute = now.format("%Y-%m-%d %H:%M").to_string();
            if minute == last_fired {
                continue;
            }
            let day = now.weekday().num_days_from_sunday() as u8;
            if !s.days.is_empty() && !s.days.contains(&day) {
                continue;
            }
            let hm = now.format("%H:%M").to_string();
            if s.start_enabled && s.start_time == hm {
                last_fired = minute.clone();
                m.start_queue();
            }
            if s.stop_enabled && s.stop_time == hm {
                last_fired = minute;
                m.stop_queue();
            }
        }
    });
}

fn hidden_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Runs the "when all downloads finish" action.
pub fn run_post_action(app: &AppHandle, action: PostAction) {
    match action {
        PostAction::None => {}
        PostAction::Exit => {
            app.state::<Arc<Manager>>().shutdown();
            app.exit(0);
        }
        PostAction::Sleep => {
            app.state::<Arc<Manager>>().save();
            let _ = hidden_command("rundll32.exe")
                .arg("powrprof.dll,SetSuspendState")
                .arg("0,1,0")
                .spawn();
        }
        PostAction::Shutdown => {
            app.state::<Arc<Manager>>().shutdown();
            // 60 s grace period; `shutdown /a` cancels it.
            let _ = hidden_command("shutdown")
                .args([
                    "/s",
                    "/t",
                    "60",
                    "/c",
                    "SwiftGet finished all downloads. The computer will shut down in 60 seconds.",
                ])
                .spawn();
        }
    }
}
