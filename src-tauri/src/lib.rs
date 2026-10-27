mod capture;
mod current_recording;
#[cfg(debug_assertions)]
mod dev;
mod export;
mod geometry;
mod macos;
mod picker;
mod recording;
mod settings;
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

#[derive(Debug, Serialize, TS)]
#[serde(tag = "event", content = "payload", rename_all = "kebab-case")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PageEvent {
    PickerSession(Session),
    PickerCursor(Point),
    PickerRecording(Option<Frame>),
    PickerKey(PickerKey),
    PickerClosed,
    RecordingStatus(RecordingStatus),
    CurrentRecording(Option<ShownRecording>),
    BarPointer(Option<Point>),
    PreviewPointer(Option<Point>),
    PreviewKey(PreviewKey),
    ExportProgress(f32),
    ExportAndClose,
}

impl PageEvent {
    pub(crate) fn send_to(self, app: &AppHandle, label: &str) -> tauri::Result<()> {
        let (name, payload) = self.split()?;
        app.emit_to(label, &name, payload)
    }

    pub(crate) fn send_to_each(
        self,
        app: &AppHandle,
        filter: impl Fn(&EventTarget) -> bool,
    ) -> tauri::Result<()> {
        let (name, payload) = self.split()?;
        app.emit_filter(&name, payload, filter)
    }

    fn split(self) -> tauri::Result<(String, serde_json::Value)> {
        let mut value = serde_json::to_value(self)?;
        let name = value["event"].as_str().unwrap_or_default().to_owned();
        Ok((name, value["payload"].take()))
    }
}

pub(crate) trait KeySet: Copy + Send + Sync + 'static {
    const KEYS: [Self; 3];
    fn shortcut(self) -> Shortcut;
    fn press(self, app: &AppHandle);

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
            app.manage(settings::AppSettings::load(
                path.app_config_dir()?.join("settings.json"),
            ));
            settings::apply(app.handle());
            let bar = app
                .get_webview_window(bar::LABEL)
                .ok_or("the bar window is missing")?;
            bar::setup(&bar)?;
            preview::setup(app.handle())?;
            editor::setup(app.handle());

            picker::prepare(app.handle().clone());
            #[cfg(debug_assertions)]
            let is_dev_editor = dev::open_editor_if_asked(app.handle());
            #[cfg(not(debug_assertions))]
            let is_dev_editor = false;
            if !is_dev_editor
                && let Err(err) = app.state::<CurrentRecording>().recover(app.handle())
            {
                eprintln!("could not recover the last recording: {err:#}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recording::recording_status,
            recording::set_capture_audio,
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
            current_recording::commands::save_recording,
            current_recording::commands::copy_recording,
            current_recording::commands::close_recording,
            current_recording::commands::show_saved_in_finder,
            current_recording::commands::edit_recording,
            current_recording::commands::shown_recording,
            current_recording::commands::load_project,
            current_recording::commands::cursor_log,
            current_recording::commands::cursor_images,
            current_recording::commands::typing_spots,
            current_recording::commands::sound_tracks,
            settings::get_settings,
            settings::set_settings,
            settings::choose_save_folder,
            settings::open_notices,
            settings::open_repo,
            current_recording::commands::save_project,
            current_recording::commands::add_background,
            current_recording::commands::export_recording,
            current_recording::commands::show_export_in_finder,
            quit
        ])
        .run(tauri::generate_context!())
}
