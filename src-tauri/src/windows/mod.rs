//! The app's fixed windows: the record bar, the recording preview and the editor, plus what
//! keeps the floating ones on the display you're using.

pub(crate) mod bar;
pub(crate) mod editor;
pub(crate) mod follow;
pub(crate) mod preview;

use tauri::{AppHandle, Manager};

/// Hides one of the fixed windows. They're never closed, so they can come back.
pub(crate) fn hide(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}
