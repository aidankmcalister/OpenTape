//! Recording: start a target, pause, restart or stop it, and announce every change as one
//! recording status. Rust owns the status; the record bar only shows it.

mod current;

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

pub(crate) use current::CurrentRecording;

use crate::capture::{self, RunningRecording, SavedRecording, Target};
use crate::macos::alert::{self, Alert, Choice};
use crate::picker;
use crate::util::{lock, run_blocking};
use crate::windows::preview;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) enum Phase {
    #[default]
    Idle,
    Starting,
    Recording,
    Paused,
    Stopping,
}

/// The recording status, the only copy of it. The record bar shows it.
#[derive(Debug, Default, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "RecordingStatus")]
pub(crate) struct Status {
    pub phase: Phase,
    /// Why the last start, restart or stop failed, until the next change.
    pub error: Option<String>,
    /// Time recorded when this status was sent, not counting pauses. The bar's timer counts
    /// on from it while recording.
    #[ts(type = "number")]
    pub elapsed_ms: u64,
}

#[derive(Default)]
pub(crate) struct RecordingState {
    running: Mutex<Option<RunningRecording>>,
    phase: Mutex<(Phase, Option<String>)>,
}

impl RecordingState {
    /// Moves from idle to starting in one step, so two quick starts can't both begin.
    fn claim(&self) -> bool {
        let mut phase = lock(&self.phase);
        if phase.0 != Phase::Idle {
            return false;
        }
        *phase = (Phase::Starting, None);
        true
    }

    fn running(&self) -> MutexGuard<'_, Option<RunningRecording>> {
        lock(&self.running)
    }

    fn status(&self) -> Status {
        let (phase, error) = lock(&self.phase).clone();
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
pub(crate) fn start(app: AppHandle, target: Target) {
    if !app.state::<RecordingState>().claim() {
        return;
    }
    announce(&app);
    tauri::async_runtime::spawn(async move { begin(&app, target).await });
}

#[tauri::command]
pub(crate) fn recording_status(state: State<'_, RecordingState>) -> Status {
    state.status()
}

#[tauri::command]
pub(crate) fn pause_recording(app: AppHandle, paused: bool) -> Result<(), String> {
    set_paused(&app, paused)
}

/// Asks first, then throws away what's been recorded and records the same target again. It
/// pauses while asking, so the alert never ends up in the recording.
#[tauri::command]
pub(crate) async fn restart_recording(
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
pub(crate) async fn stop_recording(
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
    *lock(&state.phase) = (phase, error);
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
