//! Recording: start a target, pause, restart or stop it, and announce every change as one
//! recording status. Rust owns the status; the record bar only shows it.
//!
//! Which action is allowed when is decided in one place, [`next_phase`]. The phase and the
//! running recording sit behind one lock, so a click can never see one change without the other.

mod current;

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

pub(crate) use current::CurrentRecording;

use crate::capture::{self, RunningRecording, SavedRecording, Target};
use crate::error::{CmdResult, message};
use crate::macos::alert::{self, Alert, Choice};
use crate::picker;
use crate::util::{lock, run_blocking};
use crate::windows::{bar, preview};

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

#[derive(Default)]
pub(crate) struct RecordingState(Mutex<Inner>);

/// While recording or paused, `running` is always there; in every other phase, it never is.
#[derive(Default)]
struct Inner {
    phase: Phase,
    error: Option<String>,
    running: Option<RunningRecording>,
    /// How many recordings have started, which numbers each one.
    started: u64,
}

/// What pausing found: the phase before, and which recording it paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BeforePause {
    was: Phase,
    number: u64,
}

impl RecordingState {
    fn inner(&self) -> MutexGuard<'_, Inner> {
        lock(&self.0)
    }

    /// Idle to starting in one step, so of two quick starts only the first goes through.
    fn claim(&self) -> Result<()> {
        let mut inner = self.inner();
        inner.phase = next_phase(inner.phase, Action::Start)?;
        inner.error = None;
        Ok(())
    }

    fn set_paused(&self, paused: bool) -> Result<BeforePause> {
        let mut inner = self.inner();
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
        let before = BeforePause {
            was: inner.phase,
            number: inner.started,
        };
        inner.phase = phase;
        inner.error = None;
        Ok(before)
    }

    /// Takes the recording out to stop or restart it. `number`, when given, must still be the
    /// running recording's, so a restart confirmed after its recording ended can't restart a
    /// newer one.
    fn take(&self, action: Action, number: Option<u64>) -> Result<RunningRecording> {
        let mut inner = self.inner();
        let phase = next_phase(inner.phase, action)?;
        if number.is_some_and(|number| number != inner.started) {
            bail!("that recording already ended");
        }
        let running = inner.running.take().context("not recording")?;
        inner.phase = phase;
        inner.error = None;
        Ok(running)
    }

    /// Starting to recording, now that capture runs. Nothing else leaves starting, so the
    /// phase is always still starting here.
    fn started(&self, running: RunningRecording) {
        let mut inner = self.inner();
        inner.running = Some(running);
        inner.started += 1;
        inner.phase = Phase::Recording;
        inner.error = None;
    }

    /// Back to idle, saying why when it was a failure.
    fn ended(&self, error: Option<String>) {
        let mut inner = self.inner();
        inner.phase = Phase::Idle;
        inner.error = error;
    }

    fn status(&self) -> Status {
        let inner = self.inner();
        let elapsed = inner
            .running
            .as_ref()
            .map_or(0.0, RunningRecording::elapsed);
        Status {
            phase: inner.phase,
            error: inner.error.clone(),
            elapsed_ms: (elapsed.max(0.0) * 1000.0) as u64,
        }
    }
}

/// Starts recording `target` in the background. Progress and errors arrive as status events.
pub(crate) fn start(app: AppHandle, target: Target) {
    // Refused only while a recording is already underway, like a second click on Record.
    if app.state::<RecordingState>().claim().is_err() {
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
pub(crate) fn pause_recording(app: AppHandle, paused: bool) -> CmdResult {
    app.state::<RecordingState>().set_paused(paused)?;
    announce(&app);
    Ok(())
}

/// Asks first, then throws away what's been recorded and records the same target again. It
/// pauses while asking, so the alert never ends up in the recording.
#[tauri::command]
pub(crate) async fn restart_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> CmdResult {
    let paused = state.set_paused(true)?;
    announce(&app);
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
    .await?;
    if choice != Choice::First {
        if paused.was != Phase::Paused {
            state.set_paused(false)?;
            announce(&app);
        }
        return Ok(());
    }
    let running = state.take(Action::Restart, Some(paused.number))?;
    announce(&app);
    let target = running.target().clone();
    // From here on, failures reach the bar as the status, like a failed start.
    if let Err(err) = run_blocking(move || running.discard()).await {
        end(&app, Some(&err));
        return Ok(());
    }
    begin(&app, target).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> CmdResult<SavedRecording> {
    let running = state.take(Action::Stop, None)?;
    announce(&app);
    let saved = run_blocking(move || running.stop()).await;
    end(&app, saved.as_ref().err());
    let saved = saved?;
    app.state::<CurrentRecording>()
        .keep(PathBuf::from(&saved.video_path));
    preview::show(&app, &saved.video_path);
    Ok(saved)
}

/// Opens the capture and reports how it went as a status.
async fn begin(app: &AppHandle, target: Target) {
    match open_capture(app, target).await {
        Ok(running) => {
            app.state::<RecordingState>().started(running);
            announce(app);
        }
        Err(err) => end(app, Some(&err)),
    }
}

async fn open_capture(app: &AppHandle, target: Target) -> Result<RunningRecording> {
    let folder = new_recording_folder(app)?;
    run_blocking(move || capture::start(target, folder)).await
}

/// Goes idle, which also takes down the recording's frame, however the recording ended.
fn end(app: &AppHandle, error: Option<&anyhow::Error>) {
    picker::close_frame(app);
    app.state::<RecordingState>().ended(error.map(message));
    announce(app);
}

fn announce(app: &AppHandle) {
    let status = app.state::<RecordingState>().status();
    // Fails only once the bar is gone, when there's no one left to tell.
    let _ = app.emit_to(bar::LABEL, "recording-status", status);
}

/// `<app data>/recordings/recording-<seconds since 1970>/`, out of sight until it's saved.
fn new_recording_folder(app: &AppHandle) -> Result<PathBuf> {
    let app_data = app.path().app_data_dir()?;
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    Ok(app_data.join("recordings").join(folder_name(seconds)))
}

fn folder_name(seconds_since_1970: u64) -> String {
    format!("recording-{seconds_since_1970}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A state that's recording a fake recording, with no capture behind it.
    fn recording() -> RecordingState {
        let state = RecordingState::default();
        state.claim().expect("idle can start");
        state.started(RunningRecording::fake("/tmp/recording.mov"));
        state
    }

    fn phase(state: &RecordingState) -> Phase {
        state.status().phase
    }

    #[test]
    fn folder_name_should_include_the_time() {
        assert_eq!(folder_name(1_792_000_000), "recording-1792000000");
    }

    #[test]
    fn claim_should_let_only_the_first_of_two_record_clicks_through() {
        let state = RecordingState::default();
        assert!(state.claim().is_ok());
        assert!(state.claim().is_err());
        assert_eq!(phase(&state), Phase::Starting);
    }

    #[test]
    fn stop_during_start_should_be_refused() {
        let state = RecordingState::default();
        state.claim().expect("idle can start");
        assert!(state.take(Action::Stop, None).is_err());
        assert!(state.set_paused(true).is_err());
        assert_eq!(phase(&state), Phase::Starting);
    }

    #[test]
    fn pause_resume_and_restart_while_stopping_should_be_refused() {
        let state = recording();
        state.take(Action::Stop, None).expect("recording can stop");
        assert_eq!(phase(&state), Phase::Stopping);
        assert!(state.set_paused(true).is_err());
        assert!(state.set_paused(false).is_err());
        assert!(state.take(Action::Restart, None).is_err());
        assert_eq!(phase(&state), Phase::Stopping);
    }

    #[test]
    fn restart_confirmed_after_a_stop_should_leave_the_next_recording_alone() {
        let state = recording();
        let paused = state.set_paused(true).expect("recording can pause");
        // While the restart alert is up, the recording stops and a new one starts.
        state.take(Action::Stop, None).expect("paused can stop");
        state.ended(None);
        state.claim().expect("idle can start");
        state.started(RunningRecording::fake("/tmp/next.mov"));
        assert!(state.take(Action::Restart, Some(paused.number)).is_err());
        assert_eq!(phase(&state), Phase::Recording);
    }

    #[test]
    fn restart_should_pause_and_remember_whether_it_was_already_paused() {
        let state = recording();
        assert_eq!(
            state.set_paused(true).expect("pauses").was,
            Phase::Recording
        );
        assert_eq!(state.set_paused(true).expect("pauses").was, Phase::Paused);
        let paused = state.set_paused(true).expect("pauses");
        state
            .take(Action::Restart, Some(paused.number))
            .expect("the same recording can restart");
        assert_eq!(phase(&state), Phase::Starting);
    }

    #[test]
    fn stopped_recording_should_hand_back_its_file() {
        let state = recording();
        let running = state.take(Action::Stop, None).expect("recording can stop");
        let saved = running.stop().expect("the fake finishes");
        assert_eq!(saved.video_path, "/tmp/recording.mov");
    }

    #[test]
    fn next_phase_should_refuse_everything_but_start_while_idle() {
        for action in [Action::Pause, Action::Resume, Action::Restart, Action::Stop] {
            assert!(next_phase(Phase::Idle, action).is_err());
        }
        assert_eq!(
            next_phase(Phase::Idle, Action::Start).ok(),
            Some(Phase::Starting)
        );
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
