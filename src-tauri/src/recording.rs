use std::{
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{Code, Shortcut};
use ts_rs::TS;

use crate::capture::{self, Inputs, RunningRecording, Target};
use crate::current_recording::CurrentRecording;
use crate::macos::{self, Alert, Choice};
use crate::util::{CmdResult, lock, run_blocking};
use crate::windows::bar;
use crate::{KeySet, PageEvent, picker, tray};

const COUNTDOWN_SECONDS: u32 = 3;

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
    pub microphone_refused: bool,
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
    inputs: Inputs,
    countdown: Option<u64>,
    countdowns_started: u64,
}

impl RecordingState {
    fn claim_start(&self, counts_down: bool) -> Result<Option<u64>> {
        let mut inner = lock(&self.0);
        inner.phase = next_phase(inner.phase, Action::Start)?;
        inner.error = None;
        inner.countdowns_started += 1;
        inner.countdown = counts_down.then_some(inner.countdowns_started);
        Ok(inner.countdown)
    }

    fn is_counting(&self, id: u64) -> bool {
        lock(&self.0).countdown == Some(id)
    }

    fn end_countdown(&self, id: u64) -> bool {
        let mut inner = lock(&self.0);
        let ends = inner.countdown == Some(id);
        if ends {
            inner.countdown = None;
        }
        ends
    }

    fn cancel_countdown(&self) -> bool {
        let mut inner = lock(&self.0);
        if inner.countdown.take().is_none() {
            return false;
        }
        inner.phase = Phase::Idle;
        true
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
        let running = inner.running.as_ref();
        let elapsed = running.map_or(0.0, RunningRecording::elapsed);
        RecordingStatus {
            phase: inner.phase,
            error: inner.error.clone(),
            elapsed_ms: (elapsed.max(0.0) * 1000.0) as u64,
            microphone_refused: running.is_some_and(RunningRecording::microphone_refused),
        }
    }
}

pub(crate) fn start(app: AppHandle, target: Target, countdown_on: Option<String>) {
    let Ok(countdown) = app
        .state::<RecordingState>()
        .claim_start(countdown_on.is_some())
    else {
        return;
    };
    announce_status(&app);
    thread::spawn(move || {
        if let (Some(id), Some(overlay)) = (countdown, countdown_on)
            && !count_down(&app, id, &overlay)
        {
            return;
        }
        tauri::async_runtime::block_on(start_capture(&app, target));
    });
}

fn count_down(app: &AppHandle, id: u64, overlay: &str) -> bool {
    if let Err(err) = CountdownKey::take(app) {
        log::warn!("could not take Esc, so the countdown can't be canceled: {err}");
    }
    let state = app.state::<RecordingState>();
    for left in (1..=COUNTDOWN_SECONDS).rev() {
        if !state.is_counting(id) {
            return false;
        }
        let _ = PageEvent::PickerCountdown(Some(left)).send_to(app, overlay);
        thread::sleep(Duration::from_secs(1));
    }
    if !state.end_countdown(id) {
        return false;
    }
    let _ = CountdownKey::give_back(app);
    let _ = PageEvent::PickerCountdown(None).send_to(app, overlay);
    true
}

#[derive(Debug, Clone, Copy)]
struct CountdownKey;

impl KeySet for CountdownKey {
    const KEYS: &'static [Self] = &[Self];

    fn shortcut(self) -> Shortcut {
        Shortcut::new(None, Code::Escape)
    }

    fn press(self, app: &AppHandle) {
        let _ = Self::give_back(app);
        if app.state::<RecordingState>().cancel_countdown() {
            go_idle(app, None);
        }
    }
}

pub(crate) fn start_or_stop(app: &AppHandle) {
    match app.state::<RecordingState>().status().phase {
        Phase::Recording | Phase::Paused => stop_soon(app),
        Phase::Idle => tray::new_recording(app, None),
        Phase::Starting | Phase::Stopping => {}
    }
}

#[tauri::command]
pub(crate) fn recording_status(state: State<'_, RecordingState>) -> RecordingStatus {
    state.status()
}

#[tauri::command]
pub(crate) fn set_capture_inputs(
    state: State<'_, RecordingState>,
    camera_id: Option<String>,
    microphone_id: Option<String>,
    system_audio: bool,
) {
    lock(&state.0).inputs = Inputs {
        camera_id,
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
        message: "Restarting deletes what you've recorded so far.",
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
    Ok(stop(&app, None, None).await?)
}

pub(crate) fn stop_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = stop(&app, None, None).await {
            log::warn!("could not stop the recording: {err:#}");
        }
    });
}

async fn capture_stopped(app: AppHandle, recording_number: u64, reason: String) {
    if let Err(err) = stop(&app, Some(recording_number), Some(reason)).await {
        log::error!("could not keep the recording after capture stopped: {err:#}");
    }
}

pub(crate) fn stop_before_quit(app: &AppHandle) {
    let state = app.state::<RecordingState>();
    state.cancel_countdown();
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
    let inputs = lock(&state.0).inputs.clone();
    let app = app.clone();
    let on_stop = move |reason| {
        tauri::async_runtime::spawn(capture_stopped(app.clone(), recording_number, reason));
    };
    run_blocking(move || capture::start(target, inputs, folder, on_stop)).await
}

fn go_idle(app: &AppHandle, error: Option<&anyhow::Error>) {
    picker::close_frame(app);
    let message = error.map(|err| format!("{err:#}"));
    app.state::<RecordingState>().mark_idle(message);
    announce_status(app);
}

fn announce_status(app: &AppHandle) {
    let status = app.state::<RecordingState>().status();
    tray::show_phase(app, status.phase);
    let _ = PageEvent::RecordingStatus(status).send_to(app, bar::LABEL);
}

#[cfg(test)]
mod tests;
