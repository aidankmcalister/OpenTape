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
fn a_capture_that_stops_by_itself_should_only_stop_its_own_recording() {
    let state = RecordingState::default();
    state.claim_start().expect("idle can start");
    let first = state.next_recording_number();
    state.mark_started(RunningRecording::fake("/tmp/first.mov"));
    state
        .take_running(Action::Restart, None)
        .expect("recording can restart");
    let second = state.next_recording_number();
    state.mark_started(RunningRecording::fake("/tmp/second.mov"));
    assert!(state.take_running(Action::Stop, Some(first)).is_err());
    assert_eq!(phase(&state), Phase::Recording);
    state
        .take_running(Action::Stop, Some(second))
        .expect("its own recording stops");
    assert_eq!(phase(&state), Phase::Stopping);
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
