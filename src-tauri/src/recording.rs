//! Recording: start a target, pause, restart or stop it, and announce every change as one
//! recording status. Rust owns the status; the record bar only shows it. Which action is allowed
//! when is decided in one place, `next_phase`. A stopped recording goes to the current
//! recording.

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

/// The recording status, the only copy of it. The record bar shows it.
#[derive(Debug, Default, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct RecordingStatus {
    pub phase: Phase,
    /// Why the last start, restart or stop failed, until the next change.
    pub error: Option<String>,
    /// Time recorded when this status was sent, not counting pauses. The bar's timer counts
    /// on from it while recording.
    #[ts(type = "number")]
    pub elapsed_ms: u64,
}

/// What a click asks the recording to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Start,
    Pause,
    Resume,
    Restart,
    Stop,
}

/// The phase `action` moves `phase` to, or why it can't happen now. Pausing while paused and
/// resuming while recording are allowed, so restart can pause first whatever the state.
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

/// The phase and the running recording sit behind one lock, so a click can never see one change
/// without the other.
#[derive(Default)]
pub(crate) struct RecordingState(Mutex<Inner>);

/// What sits behind the lock. While recording or paused, `running` is always there; in every
/// other phase, it never is.
#[derive(Default)]
struct Inner {
    phase: Phase,
    error: Option<String>,
    running: Option<RunningRecording>,
    /// How many recordings have started, which numbers each one.
    recordings_started: u64,
}

impl RecordingState {
    /// Idle to starting in one step, so of two quick starts only the first goes through.
    fn claim_start(&self) -> Result<()> {
        let mut inner = lock(&self.0);
        inner.phase = next_phase(inner.phase, Action::Start)?;
        inner.error = None;
        Ok(())
    }

    /// Pauses or resumes, and returns the phase before and the number of the recording.
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

    /// Takes the recording out to stop or restart it. `recording_number`, when given, must still
    /// be the running recording's, so a restart confirmed after its recording ended can't restart
    /// a newer one.
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

    /// Starting to recording, now that capture runs. No click can leave starting (see
    /// `next_phase`), so the phase is still starting here.
    fn mark_started(&self, running: RunningRecording) {
        let mut inner = lock(&self.0);
        inner.running = Some(running);
        inner.recordings_started += 1;
        inner.phase = Phase::Recording;
        inner.error = None;
    }

    /// Back to idle, saying why when it was a failure.
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

/// Starts recording `target` in the background. Progress and errors arrive as status events.
pub(crate) fn start(app: AppHandle, target: Target) {
    // Refused only while a recording is already underway, like a second click on Record.
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

/// Asks first, then throws away what's been recorded and records the same target again. It
/// pauses while asking, so the alert never ends up in the recording.
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
    // From here on, failures reach the bar as the status, like a failed start.
    if let Err(err) = run_blocking(move || running.discard()).await {
        go_idle(&app, Some(&err));
        return Ok(());
    }
    start_capture(&app, target).await;
    Ok(())
}

/// Stops, and hands the recording to the preview.
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

/// Opens the capture and reports how it went as a status.
async fn start_capture(app: &AppHandle, target: Target) {
    match open_capture(app, target).await {
        Ok(running) => {
            app.state::<RecordingState>().mark_started(running);
            announce_status(app);
        }
        Err(err) => go_idle(app, Some(&err)),
    }
}

/// Records into a new folder in app storage, out of sight until it's saved.
async fn open_capture(app: &AppHandle, target: Target) -> Result<RunningRecording> {
    let folder = app.state::<CurrentRecording>().new_folder();
    run_blocking(move || capture::start(target, folder)).await
}

/// Goes idle, which also takes down the recording's frame, however the recording ended.
fn go_idle(app: &AppHandle, error: Option<&anyhow::Error>) {
    picker::close_frame(app);
    let message = error.map(|err| format!("{err:#}"));
    app.state::<RecordingState>().mark_idle(message);
    announce_status(app);
}

fn announce_status(app: &AppHandle) {
    let status = app.state::<RecordingState>().status();
    // Fails only once the bar is gone, when there's no one left to tell.
    let _ = PageEvent::RecordingStatus(status).send_to(app, bar::LABEL);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A state that's recording a fake recording, with no capture behind it.
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
        // Restart pauses first, remembering whether it was already paused.
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
        // A second confirm of the first restart leaves the restarted recording alone.
        assert!(state.take_running(Action::Restart, Some(first)).is_err());
        assert_eq!(phase(&state), Phase::Paused);
        // So does a confirm that arrives after a stop and a new start.
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
