use anyhow::{Context, Result};
use tauri::{AppHandle, Manager, WindowEvent};

use crate::current_recording::CurrentRecording;

pub(crate) const LABEL: &str = "editor";

pub(crate) fn setup(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(err) = app.state::<CurrentRecording>().close(&app) {
                    eprintln!("{err:#}");
                }
            });
        }
    });
}

pub(crate) fn show(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window(LABEL)
        .context("the editor window is missing")?;
    window.center()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub(crate) fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}
