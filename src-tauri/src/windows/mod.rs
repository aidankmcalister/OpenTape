//! The app's fixed windows: the record bar, the recording preview and the editor, plus what
//! keeps the floating ones on the display you're using and watches the pointer for them.

pub(crate) mod bar;
pub(crate) mod editor;
pub(crate) mod follow;
mod pointer;
pub(crate) mod preview;

use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

/// Hides one of the fixed windows. They're never closed, so they can come back.
pub(crate) fn hide(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        // Fails only once the window is gone, and then it's hidden anyway.
        let _ = window.hide();
    }
}

/// Keeps a panel from ever closing: closing one crashes the app. ⌘W and `close()` both ask
/// first, so refusing here covers both; the app hides panels instead.
pub(crate) fn never_close(window: &WebviewWindow) {
    window.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
}
