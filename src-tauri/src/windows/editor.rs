//! The editor: where a recording goes after Edit in the preview. Its close button closes the
//! recording, which asks first unless it's saved.

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager, WindowEvent};

use crate::current_recording::CurrentRecording;

pub(crate) const LABEL: &str = "editor";

/// The close button closes the recording instead of the window.
pub(crate) fn setup(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = app.clone();
            // Off the main thread, since closing waits for an alert's answer.
            tauri::async_runtime::spawn_blocking(move || {
                // Nothing is waiting to hear how it went, so a failure is only logged.
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
        // Fails only once the window is gone, and then it's hidden anyway.
        let _ = window.hide();
    }
}
