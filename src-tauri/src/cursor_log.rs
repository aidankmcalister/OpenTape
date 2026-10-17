//! Polls the cursor position and mouse buttons and writes the changes as JSON Lines.
//!
//! Polling needs no permission. An event tap would need Input Monitoring, and some
//! cursor crates trigger an Accessibility prompt, which is why this polls instead.

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
use cidre::{cg, cm};

const POLLS_PER_SECOND: f64 = 240.0;
const FLUSH_EVERY: Duration = Duration::from_secs(1);

/// One reading of the cursor, timestamped on the host clock (the clock video frames use).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub left: bool,
    pub right: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    Left,
    Right,
}

/// Something worth writing down: the cursor moved, or a button went down or up.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event {
    Move {
        t: f64,
        x: f64,
        y: f64,
    },
    Down {
        t: f64,
        x: f64,
        y: f64,
        button: Button,
    },
    Up {
        t: f64,
        x: f64,
        y: f64,
        button: Button,
    },
}

impl Event {
    pub fn to_json_line(self) -> String {
        match self {
            Self::Move { t, x, y } => {
                format!(r#"{{"type":"move","t":{t:.6},"x":{x:.1},"y":{y:.1}}}"#)
            }
            Self::Down { t, x, y, button } => format!(
                r#"{{"type":"down","t":{t:.6},"x":{x:.1},"y":{y:.1},"button":"{}"}}"#,
                button.name()
            ),
            Self::Up { t, x, y, button } => format!(
                r#"{{"type":"up","t":{t:.6},"x":{x:.1},"y":{y:.1},"button":"{}"}}"#,
                button.name()
            ),
        }
    }
}

impl Button {
    fn name(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }
}

/// Returns what changed between the previous reading and this one.
pub fn events_between(previous: Option<&Sample>, now: &Sample) -> Vec<Event> {
    let Sample { t, x, y, .. } = *now;
    let Some(previous) = previous else {
        return vec![Event::Move { t, x, y }];
    };
    let mut events = Vec::new();
    if (previous.x, previous.y) != (x, y) {
        events.push(Event::Move { t, x, y });
    }
    for (button, was_down, is_down) in [
        (Button::Left, previous.left, now.left),
        (Button::Right, previous.right, now.right),
    ] {
        match (was_down, is_down) {
            (false, true) => events.push(Event::Down { t, x, y, button }),
            (true, false) => events.push(Event::Up { t, x, y, button }),
            _ => {}
        }
    }
    events
}

/// Counts from a finished log.
#[derive(Debug, Clone, Copy)]
pub struct LogSummary {
    pub polls: usize,
    pub events: usize,
}

/// A running background logger. Call [`CursorLogger::stop`] to finish the file.
pub struct CursorLogger {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<Result<LogSummary>>,
}

impl CursorLogger {
    pub fn start(path: &Path) -> Result<Self> {
        let file =
            File::create(path).with_context(|| format!("could not create {}", path.display()))?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            thread::spawn(move || poll_until_stopped(BufWriter::new(file), &stop))
        };
        Ok(Self { stop, thread })
    }

    pub fn stop(self) -> Result<LogSummary> {
        self.stop.store(true, Ordering::Relaxed);
        self.thread
            .join()
            .map_err(|_| anyhow!("the cursor logging thread panicked"))?
    }
}

fn poll_until_stopped(mut out: BufWriter<File>, stop: &AtomicBool) -> Result<LogSummary> {
    let interval = Duration::from_secs_f64(1.0 / POLLS_PER_SECOND);
    let started = Instant::now();
    let mut next_poll = started;
    let mut last_flush = started;
    let mut previous: Option<Sample> = None;
    let mut summary = LogSummary {
        polls: 0,
        events: 0,
    };

    while !stop.load(Ordering::Relaxed) {
        if let Some(sample) = read_sample() {
            for event in events_between(previous.as_ref(), &sample) {
                writeln!(out, "{}", event.to_json_line())?;
                summary.events += 1;
            }
            previous = Some(sample);
            summary.polls += 1;
        }
        if last_flush.elapsed() >= FLUSH_EVERY {
            out.flush()?;
            last_flush = Instant::now();
        }
        // Sleep until the next fixed slot, not a fixed amount, so the rate doesn't drift.
        next_poll += interval;
        match next_poll.checked_duration_since(Instant::now()) {
            Some(wait) => thread::sleep(wait),
            None => next_poll = Instant::now(),
        }
    }
    out.flush()?;
    Ok(summary)
}

fn read_sample() -> Option<Sample> {
    let location = cg::Event::with_src(None)?.location();
    let buttons = cg::EventSrcState::CombinedSession;
    Some(Sample {
        t: host_time_now(),
        x: location.x,
        y: location.y,
        left: buttons.button_state(cg::MouseButton::Left),
        right: buttons.button_state(cg::MouseButton::Right),
    })
}

/// Seconds on the host clock, the same clock ScreenCaptureKit stamps video frames with.
pub fn host_time_now() -> f64 {
    cm::Clock::host_time_clock().time().as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(x: f64, left: bool, right: bool) -> Sample {
        Sample {
            t: 1.0,
            x,
            y: 20.0,
            left,
            right,
        }
    }

    #[test]
    fn first_sample_should_be_a_move() {
        let events = events_between(None, &sample(10.0, false, false));
        assert_eq!(
            events,
            vec![Event::Move {
                t: 1.0,
                x: 10.0,
                y: 20.0
            }]
        );
    }

    #[test]
    fn unchanged_sample_should_produce_nothing() {
        let same = sample(10.0, false, false);
        assert!(events_between(Some(&same), &same).is_empty());
    }

    #[test]
    fn pressing_left_should_produce_a_down() {
        let events = events_between(
            Some(&sample(10.0, false, false)),
            &sample(10.0, true, false),
        );
        assert_eq!(
            events,
            vec![Event::Down {
                t: 1.0,
                x: 10.0,
                y: 20.0,
                button: Button::Left
            }]
        );
    }

    #[test]
    fn releasing_right_should_produce_an_up() {
        let events = events_between(
            Some(&sample(10.0, false, true)),
            &sample(10.0, false, false),
        );
        assert_eq!(
            events,
            vec![Event::Up {
                t: 1.0,
                x: 10.0,
                y: 20.0,
                button: Button::Right
            }]
        );
    }

    #[test]
    fn dragging_should_produce_a_move_and_keep_the_button_down() {
        let events = events_between(Some(&sample(10.0, true, false)), &sample(15.0, true, false));
        assert_eq!(
            events,
            vec![Event::Move {
                t: 1.0,
                x: 15.0,
                y: 20.0
            }]
        );
    }

    #[test]
    fn down_event_should_serialize_as_one_json_line() {
        let line = Event::Down {
            t: 1.5,
            x: 10.0,
            y: 20.0,
            button: Button::Left,
        }
        .to_json_line();
        assert_eq!(
            line,
            r#"{"type":"down","t":1.500000,"x":10.0,"y":20.0,"button":"left"}"#
        );
    }
}
