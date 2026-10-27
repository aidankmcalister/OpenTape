use std::{
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::capture::{self, Audio, RunningRecording, Target};
use crate::current_recording::CurrentRecording;
use crate::macos::{self, Alert, Choice};
use crate::util::{CmdResult, lock, run_blocking};
use crate::windows::bar;
use crate::{PageEvent, picker};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum Phase {
    #[default]
    Idle,
    Starting,
    Recording,
    Paused,
    Stopping,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct RecordingStatus {
    pub phase: Phase,
    pub error: Option<String>,
    #[ts(type = "number")]
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Start,
    Pause,
    Resume,
    Restart,
    Stop,
}

fn next_phase(phase: Phase, action: Action) -> Result<Phase> {
    use Phase::{Idle, Paused, Recording, Starting, Stopping};
    match (phase, action) {
        (Idle, Action::Start) => Ok(Starting),
        (Recording | Paused, Action::Pause) => Ok(Paused),
        (Recording | Paused, Action::Resume) => Ok(Recording),
        (Recording | Paused, Action::Restart) => Ok(Starting),
        (Recording | Paused, Action::Stop) => Ok(Stopping),
        (Recording | Paused, Action::Start) => bail!("already recording"),
        (Starting, _) => bail!("the recording is still starting"),
        (Stopping, _) => bail!("the recording is already stopping"),
        (Idle, _) => bail!("not recording"),
    }
}

#[derive(Default)]
pub(crate) struct RecordingState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    phase: Phase,
    error: Option<String>,
    running: Option<RunningRecording>,
    recordings_started: u64,
    audio: Audio,
}

impl RecordingState {
    fn claim_start(&self) -> Result<()> {
        let mut inner = lock(&self.0);
        inner.phase = next_phase(inner.phase, Action::Start)?;
        inner.error = None;
        Ok(())
    }

    fn set_paused(&self, paused: bool) -> Result<(Phase, u64)> {
        let mut inner = lock(&self.0);
        let action = if paused {
            Action::Pause
        } else {
            Action::Resume
        };
        let phase = next_phase(inner.phase, action)?;
        let running = inner.running.as_ref().context("not recording")?;
        if paused {
            running.pause();
        } else {
            running.resume();
        }
        let before = (inner.phase, inner.recordings_started);
        inner.phase = phase;
        inner.error = None;
        Ok(before)
    }

    fn take_running(
        &self,
        action: Action,
        recording_number: Option<u64>,
    ) -> Result<RunningRecording> {
        let mut inner = lock(&self.0);
        let phase = next_phase(inner.phase, action)?;
        if recording_number.is_some_and(|number| number != inner.recordings_started) {
            bail!("that recording already ended");
        }
        let running = inner.running.take().context("not recording")?;
        inner.phase = phase;
        inner.error = None;
        Ok(running)
    }

    fn next_recording_number(&self) -> u64 {
        lock(&self.0).recordings_started + 1
    }

    fn mark_started(&self, running: RunningRecording) {
        let mut inner = lock(&self.0);
        inner.running = Some(running);
        inner.recordings_started += 1;
        inner.phase = Phase::Recording;
        inner.error = None;
    }

    fn mark_idle(&self, error: Option<String>) {
        let mut inner = lock(&self.0);
        inner.phase = Phase::Idle;
        inner.error = error;
    }

    fn status(&self) -> RecordingStatus {
        let inner = lock(&self.0);
        let elapsed = inner
            .running
            .as_ref()
            .map_or(0.0, RunningRecording::elapsed);
        RecordingStatus {
            phase: inner.phase,
            error: inner.error.clone(),
            elapsed_ms: (elapsed.max(0.0) * 1000.0) as u64,
        }
    }
}

pub(crate) fn start(app: AppHandle, target: Target) {
    if app.state::<RecordingState>().claim_start().is_err() {
        return;
    }
    announce_status(&app);
    tauri::async_runtime::spawn(async move { start_capture(&app, target).await });
}

#[tauri::command]
pub(crate) fn recording_status(state: State<'_, RecordingState>) -> RecordingStatus {
    state.status()
}

#[tauri::command]
pub(crate) fn set_capture_audio(
    state: State<'_, RecordingState>,
    microphone_id: Option<String>,
    system_audio: bool,
) {
    lock(&state.0).audio = Audio {
        microphone_id,
        system_audio,
    };
}

#[tauri::command]
pub(crate) fn pause_recording(app: AppHandle, paused: bool) -> CmdResult {
    app.state::<RecordingState>().set_paused(paused)?;
    announce_status(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn restart_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> CmdResult {
    let (phase_before, recording_number) = state.set_paused(true)?;
    announce_status(&app);
    let alert = Alert {
        title: "Restart recording?",
        message: "What you've recorded so far will be deleted.",
        first: "Restart",
        second: None,
    };
    if macos::ask_in_background(&app, alert).await? != Choice::First {
        if phase_before != Phase::Paused {
            state.set_paused(false)?;
            announce_status(&app);
        }
        return Ok(());
    }
    let running = state.take_running(Action::Restart, Some(recording_number))?;
    announce_status(&app);
    let target = running.target().clone();
    if let Err(err) = run_blocking(move || running.discard()).await {
        go_idle(&app, Some(&err));
        return Ok(());
    }
    start_capture(&app, target).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_recording(app: AppHandle) -> CmdResult {
    stop(&app, None, None).await?;
    Ok(())
}

async fn capture_stopped(app: AppHandle, recording_number: u64, reason: String) {
    if let Err(err) = stop(&app, Some(recording_number), Some(reason)).await {
        log::error!("could not keep the recording after capture stopped: {err:#}");
    }
}

pub(crate) fn stop_before_quit(app: &AppHandle) {
    let state = app.state::<RecordingState>();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        match state.status().phase {
            Phase::Idle => return,
            Phase::Starting | Phase::Stopping => thread::sleep(Duration::from_millis(100)),
            Phase::Recording | Phase::Paused => {
                if let Err(err) = tauri::async_runtime::block_on(stop(app, None, None)) {
                    log::error!("could not keep the recording while quitting: {err:#}");
                }
            }
        }
    }
    log::error!("quit before the recording finished");
}

async fn stop(
    app: &AppHandle,
    recording_number: Option<u64>,
    reason: Option<String>,
) -> Result<()> {
    let running = app
        .state::<RecordingState>()
        .take_running(Action::Stop, recording_number)?;
    announce_status(app);
    let saved = run_blocking(move || running.stop()).await;
    let saved = match reason {
        Some(reason) => saved.context(reason),
        None => saved,
    };
    go_idle(app, saved.as_ref().err());
    let video_path = PathBuf::from(saved?.video_path);
    app.state::<CurrentRecording>().keep(app, video_path)
}

async fn start_capture(app: &AppHandle, target: Target) {
    match open_capture(app, target).await {
        Ok(running) => {
            app.state::<RecordingState>().mark_started(running);
            announce_status(app);
        }
        Err(err) => go_idle(app, Some(&err)),
    }
}

async fn open_capture(app: &AppHandle, target: Target) -> Result<RunningRecording> {
    let folder = app.state::<CurrentRecording>().new_folder()?;
    let state = app.state::<RecordingState>();
    let recording_number = state.next_recording_number();
    let audio = lock(&state.0).audio.clone();
    let app = app.clone();
    let on_stop = move |reason| {
        tauri::async_runtime::spawn(capture_stopped(app.clone(), recording_number, reason));
    };
    run_blocking(move || capture::start(target, audio, folder, on_stop)).await
}

fn go_idle(app: &AppHandle, error: Option<&anyhow::Error>) {
    picker::close_frame(app);
    let message = error.map(|err| format!("{err:#}"));
    app.state::<RecordingState>().mark_idle(message);
    announce_status(app);
}

fn announce_status(app: &AppHandle) {
    let status = app.state::<RecordingState>().status();
    let _ = PageEvent::RecordingStatus(status).send_to(app, bar::LABEL);
}

#[cfg(test)]
mod tests;
