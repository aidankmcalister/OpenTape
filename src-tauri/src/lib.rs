mod app_icons;
mod bar;
mod capture;
mod cursor_log;
mod devices;
mod glass;
mod keys;
mod macos_window;
mod picker;
mod recorder;
mod recording;
mod sources;

use tauri::{AppHandle, Manager};

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(keys::plugin())
        .manage(recording::RecordingState::default())
        .manage(picker::PickerState::default())
        .manage(bar::PillWidth::default())
        .setup(|app| {
            let bar = app
                .get_webview_window("bar")
                .ok_or("the bar window is missing")?;
            // Hidden in the config, so it doesn't flash in the middle before moving.
            bar::place_at_top(&bar)?;
            bar::add_glass(&bar)?;
            macos_window::float_over_full_screen_apps(&bar, macos_window::Level::Bar)?;
            bar::pass_clicks_beside_pill(bar, app.state::<bar::PillWidth>().inner().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recording::start_recording,
            recording::stop_recording,
            picker::open_picker,
            picker::picker_setup,
            picker::close_picker,
            picker::pick,
            devices::list_devices,
            bar::shape_bar,
            quit
        ])
        .run(tauri::generate_context!())
}
