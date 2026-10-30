mod capture;
mod current_recording;
#[cfg(debug_assertions)]
mod dev;
mod export;
mod geometry;
mod macos;
mod permissions;
mod picker;
mod recording;
mod settings;
mod tray;
mod update;
mod util;
mod windows;

use current_recording::{CurrentRecording, Folders, ShownRecording};
use geometry::{Frame, Point};
use picker::{PickerKey, Session};
use recording::{Phase, RecordingStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, RunEvent, WindowEvent};
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
    NewRecording(Option<picker::Mode>),
    SettingsChanged(settings::Settings),
    UpdateStatus(update::UpdateStatus),
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
    const KEYS: &'static [Self];
    fn shortcut(self) -> Shortcut;
    fn press(self, app: &AppHandle);

    fn take(app: &AppHandle) -> Result<(), ShortcutError> {
        let shortcuts = Self::KEYS.iter().map(|key| key.shortcut());
        app.global_shortcut()
            .on_shortcuts(shortcuts, |app, pressed, event| {
                let key = Self::KEYS
                    .iter()
                    .copied()
                    .find(|key| key.shortcut() == *pressed);
                if let (Some(key), ShortcutState::Pressed) = (key, event.state) {
                    key.press(app);
                }
            })
    }

    fn give_back(app: &AppHandle) -> Result<(), ShortcutError> {
        app.global_shortcut()
            .unregister_multiple(Self::KEYS.iter().map(|key| key.shortcut()))
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn relaunch(app: AppHandle) -> util::CmdResult {
    if recording::recording_status(app.state()).phase != Phase::Idle {
        return Err(anyhow::anyhow!("finish the recording first").into());
    }
    app.request_restart();
    Ok(())
}

pub fn run() -> tauri::Result<()> {
    permissions::answer_screen_check();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        default_hook(info);
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(err) = current_recording::commands::show_again(app) {
                log::error!("could not show the app again: {err:#}");
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Warn)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(1))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == permissions::WINDOW && matches!(event, WindowEvent::Destroyed) {
                bar::WINDOW.show(window.app_handle());
            }
        })
        .manage(recording::RecordingState::default())
        .manage(update::UpdateState::default())
        .manage(picker::PickerState::default())
        .setup(|app| {
            let path = app.path();
            app.manage(CurrentRecording::new(Folders {
                storage: path.app_data_dir()?.join("recordings"),
                downloads: path.download_dir()?,
                copies: path.app_cache_dir()?.join("copies"),
            }));
            tray::setup(app.handle())?;
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
            if let Err(err) = permissions::open_at_launch(app.handle()) {
                log::error!("could not open the permissions window: {err:#}");
            }
            update::check_quietly(app.handle());

            picker::prepare(app.handle().clone());
            #[cfg(debug_assertions)]
            let is_dev_editor = dev::open_editor_if_asked(app.handle());
            #[cfg(not(debug_assertions))]
            let is_dev_editor = false;
            if !is_dev_editor
                && let Err(err) = app.state::<CurrentRecording>().recover(app.handle())
            {
                log::error!("could not recover the last recording: {err:#}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recording::recording_status,
            recording::cancel_countdown,
            recording::set_capture_inputs,
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
            bar::hide_bar,
            bar::bar_ready,
            preview::shape_preview,
            windows::dialog_ready,
            current_recording::commands::restore_recording,
            current_recording::commands::can_restore_recording,
            current_recording::commands::close_recording,
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
            settings::open_settings,
            permissions::permissions,
            permissions::allow,
            permissions::show_permissions,
            permissions::finish_setup,
            update::update_status,
            update::check_for_update,
            update::install_update,
            update::update_menu,
            update::choose_update_menu,
            update::cancel_update,
            update::open_release_notes,
            current_recording::commands::save_project,
            current_recording::commands::add_background,
            current_recording::commands::export_recording,
            current_recording::commands::show_export_in_finder,
            quit,
            relaunch
        ])
        .build(tauri::generate_context!())?
        .run(|app, event| match event {
            RunEvent::Exit => recording::stop_before_quit(app),
            RunEvent::Reopen { .. } => {
                if let Err(err) = current_recording::commands::show_again(app) {
                    log::error!("could not show the app again: {err:#}");
                }
            }
            _ => {}
        });
    Ok(())
}
