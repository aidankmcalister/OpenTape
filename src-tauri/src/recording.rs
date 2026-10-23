use std::{path::PathBuf, sync::Mutex};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::capture::{self, RunningRecording, Target};
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
pub(crate) async fn stop_recording(app: AppHandle, state: State<'_, RecordingState>) -> CmdResult {
    let running = state.take_running(Action::Stop, None)?;
    announce_status(&app);
    let saved = run_blocking(move || running.stop()).await;
    go_idle(&app, saved.as_ref().err());
    let video_path = PathBuf::from(saved?.video_path);
    app.state::<CurrentRecording>().keep(&app, video_path)?;
    Ok(())
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
    let folder = app.state::<CurrentRecording>().new_folder();
    run_blocking(move || capture::start(target, folder)).await
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
mod tests {
    use super::*;

    fn recording() -> RecordingState {
        let state = RecordingState::default();
        state.claim_start().expect("idle can start");
        state.mark_started(RunningRecording::fake("/tmp/recording.mov"));
        state
    }

    fn phase(state: &RecordingState) -> Phase {
        state.status().phase
    }

    #[test]
    fn next_phase_should_allow_only_these_moves() {
        use Action::{Pause, Restart, Resume, Start, Stop};
        use Phase::{Idle, Paused, Recording, Starting, Stopping};
        let allowed = [
            (Idle, Start, Starting),
            (Recording, Pause, Paused),
            (Paused, Pause, Paused),
            (Recording, Resume, Recording),
            (Paused, Resume, Recording),
            (Recording, Restart, Starting),
            (Paused, Restart, Starting),
            (Recording, Stop, Stopping),
            (Paused, Stop, Stopping),
        ];
        for phase in [Idle, Starting, Recording, Paused, Stopping] {
            for action in [Start, Pause, Resume, Restart, Stop] {
                let expected = allowed
                    .iter()
                    .find(|(from, by, _)| (*from, *by) == (phase, action))
                    .map(|(_, _, to)| *to);
                let next = next_phase(phase, action).ok();
                assert_eq!(next, expected, "{phase:?} + {action:?}");
            }
        }
    }

    #[test]
    fn a_start_should_let_one_click_through_and_say_why_it_failed() {
        let state = RecordingState::default();
        assert!(state.claim_start().is_ok());
        assert!(state.claim_start().is_err());
        assert!(state.take_running(Action::Stop, None).is_err());
        assert!(state.set_paused(true).is_err());
        assert_eq!(phase(&state), Phase::Starting);
        state.mark_idle(Some("could not start capture".into()));
        let status = state.status();
        assert_eq!(status.phase, Phase::Idle);
        assert_eq!(status.error.as_deref(), Some("could not start capture"));
        state.claim_start().expect("idle can start again");
        assert_eq!(state.status().error, None);
    }

    #[test]
    fn pause_resume_and_stop_should_move_a_recording_along() {
        let state = recording();
        assert_eq!(state.set_paused(true).expect("pauses").0, Phase::Recording);
        assert_eq!(phase(&state), Phase::Paused);
        assert_eq!(state.set_paused(false).expect("resumes").0, Phase::Paused);
        assert_eq!(phase(&state), Phase::Recording);
        state.set_paused(true).expect("recording can pause");
        let running = state
            .take_running(Action::Stop, None)
            .expect("paused can stop");
        assert_eq!(phase(&state), Phase::Stopping);
        assert!(state.set_paused(true).is_err());
        assert!(state.set_paused(false).is_err());
        assert!(state.take_running(Action::Restart, None).is_err());
        assert_eq!(phase(&state), Phase::Stopping);
        let saved = running.stop().expect("the fake finishes");
        assert_eq!(saved.video_path, "/tmp/recording.mov");
        state.mark_idle(None);
        assert_eq!(phase(&state), Phase::Idle);
        assert!(state.claim_start().is_ok());
    }

    #[test]
    fn restart_should_only_restart_the_recording_it_paused() {
        let state = recording();
        let (before, first) = state.set_paused(true).expect("pauses");
        assert_eq!(before, Phase::Recording);
        assert_eq!(state.set_paused(true).expect("pauses").0, Phase::Paused);
        state
            .take_running(Action::Restart, Some(first))
            .expect("the same recording can restart");
        assert_eq!(phase(&state), Phase::Starting);
        state.mark_started(RunningRecording::fake("/tmp/again.mov"));
        let (_, second) = state.set_paused(true).expect("pauses");
        assert_eq!(second, first + 1);
        assert!(state.take_running(Action::Restart, Some(first)).is_err());
        assert_eq!(phase(&state), Phase::Paused);
        state
            .take_running(Action::Stop, None)
            .expect("paused can stop");
        state.mark_idle(None);
        state.claim_start().expect("idle can start");
        state.mark_started(RunningRecording::fake("/tmp/next.mov"));
        assert!(state.take_running(Action::Restart, Some(second)).is_err());
        assert_eq!(phase(&state), Phase::Recording);
    }

    #[test]
    fn status_should_reach_the_frontend_in_its_shape() {
        let status = RecordingStatus {
            phase: Phase::Paused,
            error: None,
            elapsed_ms: 1500,
        };
        let json = serde_json::to_string(&status).expect("status serializes");
        assert_eq!(json, r#"{"phase":"paused","error":null,"elapsedMs":1500}"#);
    }
}
