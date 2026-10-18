//! The editor: where a recording goes after Edit in the preview. Closing it deletes the
//! recording unless it was saved, so an unsaved one asks first.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use ts_rs::TS;

use super::{bar, preview};
use crate::macos::alert::{self, Alert, Choice};
use crate::recording::CurrentRecording;

pub(crate) const LABEL: &str = "editor";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct Opened {
    video_path: String,
}

/// The close button asks first instead of closing.
pub(crate) fn setup(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || close(&app));
        }
    });
}

/// Moves the recording from the preview into the editor.
#[tauri::command]
pub(crate) fn edit_recording(
    app: AppHandle,
    current: State<'_, CurrentRecording>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or("the editor window is missing")?;
    let opened = opened(&current).ok_or("there's no recording to edit")?;
    super::hide(&app, preview::LABEL);
    let _ = app.emit_to(LABEL, "editor-open", opened);
    window.center().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())
}

/// The recording the editor has open, for a page that loads after `editor-open` was sent.
#[tauri::command]
pub(crate) fn editor_recording(current: State<'_, CurrentRecording>) -> Option<Opened> {
    opened(&current)
}

/// Exporting from the editor isn't built yet, so an unsaved recording can only be deleted.
fn close(app: &AppHandle) {
    let current = app.state::<CurrentRecording>();
    if current.saved_to().is_none() {
        let choice = alert::ask(
            app,
            Alert {
                title: "Delete this recording and close?",
                message: "It hasn't been saved, and exporting from the editor isn't ready yet.",
                first: "Delete and close",
                second: None,
            },
        );
        if choice != Choice::First {
            return;
        }
    }
    super::hide(app, LABEL);
    let _ = app.emit_to(LABEL, "editor-closed", ());
    bar::show(app);
    if let Err(err) = current.discard() {
        eprintln!("{err}");
    }
}

fn opened(current: &CurrentRecording) -> Option<Opened> {
    current.video_path().map(|path| Opened {
        video_path: path.display().to_string(),
    })
}
