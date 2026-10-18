//! Recording: start a target, pause, restart or stop it, and announce every change as one
//! recording status. Rust owns the status; the record bar only shows it.

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard, PoisonError},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::alert::{self, Alert, Choice};
use crate::capture::{self, RunningRecording, SavedRecording, Target};
use crate::picker;
use crate::preview;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Idle,
    Starting,
    Recording,
    Paused,
    Stopping,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    /// Why the last start, restart or stop failed, until the next change.
    pub error: Option<String>,
    /// Time recorded when this status was sent, not counting pauses. The bar's timer counts
    /// on from it while recording.
    pub elapsed_ms: u64,
}

/// The recording you've just made. It waits in app storage while the preview and then the editor
/// show it. Saving exports an `.mp4` elsewhere; closing deletes this copy either way.
#[derive(Default)]
pub struct CurrentRecording(Mutex<Option<Current>>);

struct Current {
    video_path: PathBuf,
    saved_to: Option<PathBuf>,
}

impl CurrentRecording {
    pub fn video_path(&self) -> Option<PathBuf> {
        self.slot()
            .as_ref()
            .map(|current| current.video_path.clone())
    }

    /// Where it was saved, if it's been saved and the file is still there.
    pub fn saved_to(&self) -> Option<PathBuf> {
        let saved_to = self.slot().as_ref()?.saved_to.clone()?;
        saved_to.exists().then_some(saved_to)
    }

    pub fn mark_saved(&self, path: PathBuf) {
        if let Some(current) = self.slot().as_mut() {
            current.saved_to = Some(path);
        }
    }

    /// Deletes the recording's folder in app storage, if there's a recording.
    pub fn discard(&self) -> Result<(), String> {
        let Some(current) = self.slot().take() else {
            return Ok(());
        };
        let Some(folder) = current.video_path.parent() else {
            return Ok(());
        };
        std::fs::remove_dir_all(folder)
            .map_err(|err| format!("could not delete {}: {err}", folder.display()))
    }

    fn keep(&self, video_path: PathBuf) {
        *self.slot() = Some(Current {
            video_path,
            saved_to: None,
        });
    }

    fn slot(&self) -> MutexGuard<'_, Option<Current>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Default)]
pub struct RecordingState {
    running: Mutex<Option<RunningRecording>>,
    phase: Mutex<(Phase, Option<String>)>,
}

impl RecordingState {
    /// Moves from idle to starting in one step, so two quick starts can't both begin.
    fn claim(&self) -> bool {
        let mut phase = self.phase.lock().unwrap_or_else(PoisonError::into_inner);
        if phase.0 != Phase::Idle {
            return false;
        }
        *phase = (Phase::Starting, None);
        true
    }

    fn running(&self) -> MutexGuard<'_, Option<RunningRecording>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn status(&self) -> Status {
        let (phase, error) = self
            .phase
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        let elapsed = self
            .running()
            .as_ref()
            .map_or(0.0, RunningRecording::elapsed);
        Status {
            phase,
            error,
            elapsed_ms: (elapsed.max(0.0) * 1000.0) as u64,
        }
    }
}

/// Starts recording `target` in the background. Progress and errors arrive as status events.
pub fn start(app: AppHandle, target: Target) {
    if !app.state::<RecordingState>().claim() {
        return;
    }
    announce(&app);
    tauri::async_runtime::spawn(async move { begin(&app, target).await });
}

#[tauri::command]
pub fn recording_status(state: State<'_, RecordingState>) -> Status {
    state.status()
}

#[tauri::command]
pub fn pause_recording(app: AppHandle, paused: bool) -> Result<(), String> {
    set_paused(&app, paused)
}

/// Asks first, then throws away what's been recorded and records the same target again. It
/// pauses while asking, so the alert never ends up in the recording.
#[tauri::command]
pub async fn restart_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let was_paused = state.status().phase == Phase::Paused;
    set_paused(&app, true)?;
    let asking = app.clone();
    let choice = tauri::async_runtime::spawn_blocking(move || {
        alert::ask(
            &asking,
            Alert {
                title: "Restart recording?",
                message: "What you've recorded so far will be deleted.",
                first: "Restart",
                second: None,
            },
        )
    })
    .await
    .map_err(|err| err.to_string())?;
    if choice != Choice::First {
        return if was_paused {
            Ok(())
        } else {
            set_paused(&app, false)
        };
    }
    let running = state.running().take().ok_or("not recording")?;
    let target = running.target().clone();
    set_status(&app, Phase::Starting, None);
    if let Err(err) = run_blocking(move || running.discard()).await {
        set_status(&app, Phase::Idle, Some(err));
        return Ok(());
    }
    begin(&app, target).await;
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<SavedRecording, String> {
    let running = state.running().take().ok_or("not recording")?;
    set_status(&app, Phase::Stopping, None);
    let saved = run_blocking(move || running.stop()).await;
    set_status(&app, Phase::Idle, saved.as_ref().err().cloned());
    if let Ok(saved) = &saved {
        app.state::<CurrentRecording>()
            .keep(PathBuf::from(&saved.video_path));
        preview::show(&app, &saved.video_path);
    }
    saved
}

/// Runs blocking capture work off the main thread and turns errors into readable strings.
pub async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| format!("{err:#}"))
}

fn set_paused(app: &AppHandle, paused: bool) -> Result<(), String> {
    let state = app.state::<RecordingState>();
    let phase = {
        let running = state.running();
        let running = running.as_ref().ok_or("not recording")?;
        if paused {
            running.pause();
            Phase::Paused
        } else {
            running.resume();
            Phase::Recording
        }
    };
    set_status(app, phase, None);
    Ok(())
}

/// Opens the capture and reports how it went as a status.
async fn begin(app: &AppHandle, target: Target) {
    match open_capture(app, target).await {
        Ok(running) => {
            *app.state::<RecordingState>().running() = Some(running);
            set_status(app, Phase::Recording, None);
        }
        Err(err) => set_status(app, Phase::Idle, Some(err)),
    }
}

async fn open_capture(app: &AppHandle, target: Target) -> Result<RunningRecording, String> {
    let folder = new_recording_folder(app)?;
    run_blocking(move || capture::start(target, folder)).await
}

/// Going idle also takes down the recording's frame, however the recording ended.
fn set_status(app: &AppHandle, phase: Phase, error: Option<String>) {
    if phase == Phase::Idle {
        picker::close_frame(app);
    }
    let state = app.state::<RecordingState>();
    *state.phase.lock().unwrap_or_else(PoisonError::into_inner) = (phase, error);
    announce(app);
}

fn announce(app: &AppHandle) {
    let status = app.state::<RecordingState>().status();
    let _ = app.emit("recording-status", status);
}

/// `<app data>/recordings/recording-<seconds since 1970>/`, out of sight until it's saved.
fn new_recording_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs();
    Ok(app_data.join("recordings").join(folder_name(seconds)))
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

    #[test]
    fn claim_should_let_only_the_first_start_through() {
        let state = RecordingState::default();
        assert!(state.claim());
        assert!(!state.claim());
    }

    #[test]
    fn status_should_reach_the_frontend_in_its_shape() {
        let status = Status {
            phase: Phase::Paused,
            error: None,
            elapsed_ms: 1500,
        };
        let json = serde_json::to_string(&status).expect("status serializes");
        assert_eq!(json, r#"{"phase":"paused","error":null,"elapsedMs":1500}"#);
    }
}
