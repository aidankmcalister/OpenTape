use std::process::Command;
use std::time::Duration;

use cidre::{av, cg};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::settings::{self, AppSettings, Settings};
use crate::util::{CmdResult, run_blocking, wait};
use crate::windows::{self, bar};

pub(crate) const WINDOW: &str = "permissions";
const SCREEN_CHECK_ARG: &str = "--has-screen-access";
const SCREEN_RECORDING_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const MICROPHONE_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum Access {
    Allowed,
    NeedsRestart,
    NotAsked,
    Off,
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum Permission {
    ScreenRecording,
    Microphone,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Permissions {
    pub screen_recording: Access,
    pub microphone: Access,
    pub has_finished_setup: bool,
}

pub(crate) fn answer_screen_check() {
    if std::env::args().any(|arg| arg == SCREEN_CHECK_ARG) {
        std::process::exit(i32::from(!cg::screen_capture_access::preflight()));
    }
}

fn screen_recording() -> Access {
    if cg::screen_capture_access::preflight() {
        return Access::Allowed;
    }
    let is_on_for_a_new_process = std::env::current_exe()
        .and_then(|exe| Command::new(exe).arg(SCREEN_CHECK_ARG).status())
        .is_ok_and(|status| status.success());
    if is_on_for_a_new_process {
        Access::NeedsRestart
    } else {
        Access::NotAsked
    }
}

fn microphone() -> Access {
    match av::CaptureDevice::authorization_status_for_media_type(av::MediaType::audio()) {
        Ok(av::AuthorizationStatus::Authorized) => Access::Allowed,
        Ok(av::AuthorizationStatus::NotDetermined) => Access::NotAsked,
        _ => Access::Off,
    }
}

pub(crate) fn open_at_launch(app: &AppHandle) -> tauri::Result<()> {
    let has_finished_setup = app.state::<AppSettings>().current().has_finished_setup;
    if has_finished_setup && cg::screen_capture_access::preflight() {
        bar::show_when_ready();
        return Ok(());
    }
    show(app)
}

pub(crate) fn focus_if_open(app: &AppHandle) -> bool {
    app.get_webview_window(WINDOW)
        .is_some_and(|window| window.show().and_then(|()| window.set_focus()).is_ok())
}

fn show(app: &AppHandle) -> tauri::Result<()> {
    bar::WINDOW.hide(app);
    windows::show_dialog(app, WINDOW, |window| {
        window.title("OpenTape").inner_size(456.0, 396.0)
    })
}

#[tauri::command]
pub(crate) async fn permissions(app: AppHandle) -> CmdResult<Permissions> {
    let has_finished_setup = app.state::<AppSettings>().current().has_finished_setup;
    let permissions = run_blocking(move || {
        Ok(Permissions {
            screen_recording: screen_recording(),
            microphone: microphone(),
            has_finished_setup,
        })
    })
    .await?;
    Ok(permissions)
}

#[tauri::command]
pub(crate) async fn allow(permission: Permission) -> CmdResult {
    match permission {
        Permission::ScreenRecording => {
            cg::screen_capture_access::request();
            settings::open_url(SCREEN_RECORDING_PANE).await?;
        }
        Permission::Microphone if microphone() == Access::NotAsked => {
            run_blocking(|| {
                wait(
                    "asking for the microphone",
                    Duration::from_secs(60),
                    av::CaptureDevice::request_access_for_media_type(av::MediaType::audio()),
                )
                .map(drop)
            })
            .await?;
        }
        Permission::Microphone => settings::open_url(MICROPHONE_PANE).await?,
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn show_permissions(app: AppHandle) -> CmdResult {
    show(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn finish_setup(app: AppHandle) -> CmdResult {
    let current = app.state::<AppSettings>().current();
    settings::set_settings(
        app.clone(),
        Settings {
            has_finished_setup: true,
            ..current
        },
    )?;
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.close()?;
    }
    Ok(())
}
