//! The Tauri commands the record bar calls: list what can be recorded, start, and stop.
//! Rust owns the recording state; the frontend only shows it.

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, State};

use crate::capture::{self, RunningRecording, SavedRecording, Sources, Target};

/// The recording in progress, if any.
#[derive(Default)]
pub struct RecordingState(Mutex<Option<RunningRecording>>);

#[tauri::command]
pub async fn list_sources() -> Result<Sources, String> {
    run_blocking(capture::list_sources).await
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
    target: Target,
) -> Result<(), String> {
    if lock(&state)?.is_some() {
        return Err("already recording".into());
    }
    let folder = new_recording_folder(&app)?;
    let running = run_blocking(move || capture::start(target, folder)).await?;
    let mut current = lock(&state)?;
    if current.is_some() {
        // Another start won the race. Dropping `running` stops it and finishes its file.
        return Err("already recording".into());
    }
    *current = Some(running);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, RecordingState>) -> Result<SavedRecording, String> {
    let running = lock(&state)?.take().ok_or("not recording")?;
    run_blocking(move || running.stop()).await
}

/// Runs blocking capture work off the main thread and turns errors into readable strings.
async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| format!("{err:#}"))
}

fn lock<'a>(
    state: &'a State<'_, RecordingState>,
) -> Result<MutexGuard<'a, Option<RunningRecording>>, String> {
    state
        .0
        .lock()
        .map_err(|_| "the recording state is broken; restart the app".to_string())
}

/// `~/Movies/screen-recorder/recording-<seconds since 1970>/`
fn new_recording_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let movies = app.path().video_dir().map_err(|err| err.to_string())?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs();
    Ok(movies.join("screen-recorder").join(folder_name(seconds)))
}

fn folder_name(seconds_since_1970: u64) -> String {
    format!("recording-{seconds_since_1970}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_name_should_include_the_time() {
        assert_eq!(folder_name(1_792_000_000), "recording-1792000000");
    }
}
