//! The app's entry point: registers the shared state, sets up the fixed windows, and lists
//! every command the frontend can call.

mod capture;
mod devices;
mod export;
mod geometry;
mod macos;
mod picker;
mod recording;
mod util;
mod windows;

use macos::keys::{self, Key};
use tauri::{AppHandle, Manager};
use windows::{bar, editor, follow, preview};

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Each key goes to the window that took it.
fn on_key(app: &AppHandle, key: Key) {
    match key {
        Key::Escape | Key::Enter | Key::Tab => picker::on_key(app, key),
        Key::Edit | Key::Copy | Key::Save => preview::on_key(app, key),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(keys::plugin(on_key))
        .manage(recording::RecordingState::default())
        .manage(picker::PickerState::default())
        .manage(bar::PillWidth::default())
        .manage(recording::CurrentRecording::default())
        .setup(|app| {
            let bar = app
                .get_webview_window(bar::LABEL)
                .ok_or("the bar window is missing")?;
            bar::setup(bar, app.state::<bar::PillWidth>().inner().clone())?;
            preview::setup(app.handle())?;
            editor::setup(app.handle());
            follow::start(app.handle().clone());
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
            devices::list_devices,
            bar::shape_bar,
            preview::save_recording,
            preview::copy_recording,
            preview::close_preview,
            preview::show_saved_in_finder,
            editor::edit_recording,
            editor::editor_recording,
            quit
        ])
        .run(tauri::generate_context!())
}
