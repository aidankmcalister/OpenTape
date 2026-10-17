mod capture;
mod cursor_log;
mod recorder;
mod recording;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(recording::RecordingState::default())
        .invoke_handler(tauri::generate_handler![
            recording::list_sources,
            recording::start_recording,
            recording::stop_recording
        ])
        .run(tauri::generate_context!())
}
