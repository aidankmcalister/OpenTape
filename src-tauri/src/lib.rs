//! The app's entry point: registers the shared state, sets up the fixed windows and the
//! system-wide keys, and lists every command the frontend can call and every event Rust sends.

mod capture;
mod current_recording;
mod geometry;
mod macos;
mod picker;
mod recording;
mod util;
mod windows;

use current_recording::{CurrentRecording, Folders, ShownRecording};
use geometry::{Frame, Point};
use picker::{PickerKey, Session};
use recording::RecordingStatus;
use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use tauri_plugin_global_shortcut::{
    Error as ShortcutError, GlobalShortcutExt, Shortcut, ShortcutState,
};
use ts_rs::TS;
use windows::preview::PreviewKey;
use windows::{bar, editor, preview};

/// Every event Rust sends the pages, named the way the pages hear it, with what it carries. The
/// pages read each event's payload type from this, so the two can't drift apart.
#[derive(Debug, Serialize, TS)]
#[serde(tag = "event", content = "payload", rename_all = "kebab-case")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PageEvent {
    PickerSession(Session),
    PickerCursor(Point),
    /// Where the window being recorded sits, sent to the overlay that frames the recording.
    PickerRecording(Option<Frame>),
    PickerKey(PickerKey),
    PickerClosed,
    RecordingStatus(RecordingStatus),
    CurrentRecording(Option<ShownRecording>),
    PreviewPointer(Option<Point>),
    PreviewKey(PreviewKey),
}

impl PageEvent {
    /// Sends it to the window labelled `label`.
    pub(crate) fn send_to(self, app: &AppHandle, label: &str) -> tauri::Result<()> {
        let (name, payload) = self.split()?;
        app.emit_to(label, &name, payload)
    }

    /// Sends it to every window `filter` picks.
    pub(crate) fn send_to_each(
        self,
        app: &AppHandle,
        filter: impl Fn(&EventTarget) -> bool,
    ) -> tauri::Result<()> {
        let (name, payload) = self.split()?;
        app.emit_filter(&name, payload, filter)
    }

    /// Its name and its payload, as serde writes them for the pages.
    fn split(self) -> tauri::Result<(String, serde_json::Value)> {
        let mut value = serde_json::to_value(self)?;
        let name = value["event"].as_str().unwrap_or_default().to_owned();
        Ok((name, value["payload"].take()))
    }
}

/// Keys taken system-wide for a while, because this app's floating windows aren't the focused
/// window. Each set says which keys it takes and what pressing one does, so no one else has to
/// know its keys.
pub(crate) trait KeySet: Copy + Send + Sync + 'static {
    const KEYS: [Self; 3];
    fn shortcut(self) -> Shortcut;
    fn press(self, app: &AppHandle);

    /// Takes the set's keys until `give_back`.
    fn take(app: &AppHandle) -> Result<(), ShortcutError> {
        let shortcuts = Self::KEYS.map(Self::shortcut);
        app.global_shortcut()
            .on_shortcuts(shortcuts, |app, pressed, event| {
                let key = Self::KEYS
                    .into_iter()
                    .find(|key| key.shortcut() == *pressed);
                if let (Some(key), ShortcutState::Pressed) = (key, event.state) {
                    key.press(app);
                }
            })
    }

    fn give_back(app: &AppHandle) -> Result<(), ShortcutError> {
        app.global_shortcut()
            .unregister_multiple(Self::KEYS.map(Self::shortcut))
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(recording::RecordingState::default())
        .manage(picker::PickerState::default())
        .setup(|app| {
            let path = app.path();
            app.manage(CurrentRecording::new(Folders {
                storage: path.app_data_dir()?.join("recordings"),
                downloads: path.download_dir()?,
                copies: path.app_cache_dir()?.join("copies"),
            }));
            let bar = app
                .get_webview_window(bar::LABEL)
                .ok_or("the bar window is missing")?;
            bar::setup(&bar)?;
            preview::setup(app.handle())?;
            editor::setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recording::recording_status,
            recording::pause_recording,
            recording::restart_recording,
            recording::stop_recording,
            picker::open_picker,
            picker::picker_setup,
            picker::close_picker,
            picker::record,
            picker::pin_window,
            picker::move_area,
            picker::place_overlay_glass,
            bar::list_devices,
            bar::shape_bar,
            current_recording::save_recording,
            current_recording::copy_recording,
            current_recording::close_recording,
            current_recording::show_saved_in_finder,
            current_recording::edit_recording,
            current_recording::editor_recording,
            quit
        ])
        .run(tauri::generate_context!())
}
