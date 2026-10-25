use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
use cidre::cg;

use super::timeline::host_time_now;
use crate::macos::cursor::KindReader;

const KIND_EVERY: u32 = 24;

pub(super) struct CursorLogger {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<()>>>,
}

impl CursorLogger {
    pub(super) fn start(path: &Path) -> Result<Self> {
        let file =
            File::create(path).with_context(|| format!("could not create {}", path.display()))?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            thread::spawn(move || poll_until_stopped(BufWriter::new(file), &stop))
        };
        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }

    pub(super) fn stop(mut self) -> Result<()> {
        self.stop.store(true, Ordering::Relaxed);
        let Some(thread) = self.thread.take() else {
            return Ok(());
        };
        thread
            .join()
            .map_err(|_| anyhow!("the cursor logging thread panicked"))?
    }
}

impl Drop for CursorLogger {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Sample {
    t: f64,
    x: f64,
    y: f64,
    left: bool,
    right: bool,
}

fn poll_until_stopped(mut out: BufWriter<File>, stop: &AtomicBool) -> Result<()> {
    let interval = Duration::from_secs_f64(1.0 / 240.0);
    let mut next_poll = Instant::now();
    let mut last_flush = Instant::now();
    let mut previous: Option<Sample> = None;
    let kinds = KindReader::new();
    let mut kind = "";
    let state = cg::EventSrcState::CombinedSession;
    let mut keys = state.counter_for_event_type(cg::EventType::KEY_DOWN);
    let mut polls: u32 = 0;
    while !stop.load(Ordering::Relaxed) {
        if let Some(event) = cg::Event::with_src(None) {
            let location = event.location();
            let sample = Sample {
                t: host_time_now(),
                x: location.x,
                y: location.y,
                left: state.button_state(cg::MouseButton::Left),
                right: state.button_state(cg::MouseButton::Right),
            };
            for line in lines_between(previous.as_ref(), &sample) {
                writeln!(out, "{line}")?;
            }
            if polls.is_multiple_of(KIND_EVERY) {
                let now = kinds.current();
                if now != kind {
                    kind = now;
                    writeln!(
                        out,
                        r#"{{"type":"cursor","t":{:.6},"x":{:.1},"y":{:.1},"kind":"{kind}"}}"#,
                        sample.t, sample.x, sample.y
                    )?;
                }
                let typed = state.counter_for_event_type(cg::EventType::KEY_DOWN);
                if typed != keys {
                    keys = typed;
                    writeln!(out, r#"{{"type":"key","t":{:.6}}}"#, sample.t)?;
                }
            }
            polls += 1;
            previous = Some(sample);
        }
        if last_flush.elapsed() >= Duration::from_secs(1) {
            out.flush()?;
            last_flush = Instant::now();
        }
        next_poll += interval;
        match next_poll.checked_duration_since(Instant::now()) {
            Some(wait) => thread::sleep(wait),
            None => next_poll = Instant::now(),
        }
    }
    out.flush()?;
    Ok(())
}

fn lines_between(previous: Option<&Sample>, now: &Sample) -> Vec<String> {
    let position = format!(r#""t":{:.6},"x":{:.1},"y":{:.1}"#, now.t, now.x, now.y);
    let move_line = format!(r#"{{"type":"move",{position}}}"#);
    let Some(previous) = previous else {
        return vec![move_line];
    };
    let mut lines = Vec::new();
    if (previous.x, previous.y) != (now.x, now.y) {
        lines.push(move_line);
    }
    for (button, was_down, is_down) in [
        ("left", previous.left, now.left),
        ("right", previous.right, now.right),
    ] {
        let kind = match (was_down, is_down) {
            (false, true) => "down",
            (true, false) => "up",
            _ => continue,
        };
        lines.push(format!(
            r#"{{"type":"{kind}",{position},"button":"{button}"}}"#
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(x: f64, left: bool, right: bool) -> Sample {
        Sample {
            t: 1.5,
            x,
            y: 20.0,
            left,
            right,
        }
    }

    #[test]
    fn lines_between_should_log_a_move_then_each_button_change() {
        let still = sample(10.0, false, false);
        let move_10 = r#"{"type":"move","t":1.500000,"x":10.0,"y":20.0}"#;
        let move_15 = r#"{"type":"move","t":1.500000,"x":15.0,"y":20.0}"#;
        let cases: [(Option<Sample>, Sample, &[&str]); 8] = [
            (None, sample(10.0, true, false), &[move_10]),
            (Some(still), still, &[]),
            (
                Some(still),
                sample(10.0, true, false),
                &[r#"{"type":"down","t":1.500000,"x":10.0,"y":20.0,"button":"left"}"#],
            ),
            (
                Some(sample(10.0, false, true)),
                still,
                &[r#"{"type":"up","t":1.500000,"x":10.0,"y":20.0,"button":"right"}"#],
            ),
            (
                Some(sample(10.0, true, false)),
                sample(15.0, true, false),
                &[move_15],
            ),
            (
                Some(sample(10.0, false, true)),
                sample(10.0, false, true),
                &[],
            ),
            (
                Some(still),
                sample(10.4, false, false),
                &[r#"{"type":"move","t":1.500000,"x":10.4,"y":20.0}"#],
            ),
            (
                Some(still),
                sample(15.0, true, true),
                &[
                    move_15,
                    r#"{"type":"down","t":1.500000,"x":15.0,"y":20.0,"button":"left"}"#,
                    r#"{"type":"down","t":1.500000,"x":15.0,"y":20.0,"button":"right"}"#,
                ],
            ),
        ];
        for (previous, now, expected) in cases {
            let lines = lines_between(previous.as_ref(), &now);
            assert_eq!(lines, expected, "{previous:?} then {now:?}");
        }
    }

    #[test]
    fn dropping_a_logger_should_tell_its_thread_to_end() {
        let path = std::env::temp_dir().join(format!("cursor-log-{}.jsonl", std::process::id()));
        let logger = CursorLogger::start(&path).expect("a temp file can be created");
        let stop = Arc::clone(&logger.stop);
        drop(logger);
        assert!(stop.load(Ordering::Relaxed));
        let _ = std::fs::remove_file(path);
    }
}
