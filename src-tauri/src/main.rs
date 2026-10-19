//! Starts the app. Everything else lives in the library, in `lib.rs`.

fn main() -> tauri::Result<()> {
    screen_recorder_lib::run()
}
