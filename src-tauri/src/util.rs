//! Small helpers shared across the app, and the one error type commands return.

use std::{
    sync::{
        Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use serde::{Serialize, Serializer};

/// Locks `mutex`, carrying on with its data even if another thread panicked while holding it.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs blocking work on a background thread, so it holds up neither the main thread nor the
/// async runtime.
pub(crate) async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tauri::async_runtime::spawn_blocking(job).await?
}

/// What a fallible `#[tauri::command]` returns. Inside, the app uses `anyhow`; at the command
/// edge `?` turns every error into one plain string with its causes, like "could not start
/// capture: ...", which is what the frontend shows.
pub(crate) type CmdResult<T = ()> = Result<T, CommandError>;

#[derive(Debug)]
pub(crate) struct CommandError(String);

/// Accepts any error `anyhow` does, such as I/O and Tauri errors.
impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        // `{:#}` puts the error and its causes on one line, outermost first.
        Self(format!("{:#}", err.into()))
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// A background loop that runs only while a window needs it, so a hidden window costs nothing.
/// Each window keeps one in a `static`.
pub(crate) struct Poller {
    /// Bumped on every start and stop. A loop keeps going only while it still matches the
    /// number it started with, so starting again or stopping ends it by its next tick.
    generation: AtomicU64,
}

impl Poller {
    pub(crate) const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }

    /// Calls `tick` every `every` on a new thread, replacing any loop already running, until
    /// `stop` or until `tick` returns `false`.
    pub(crate) fn start(
        &'static self,
        every: Duration,
        mut tick: impl FnMut() -> bool + Send + 'static,
    ) {
        let this_loop = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        thread::spawn(move || {
            while self.generation.load(Ordering::SeqCst) == this_loop && tick() {
                thread::sleep(every);
            }
        });
    }

    pub(crate) fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, atomic::AtomicUsize};

    use anyhow::{Context, anyhow};

    use super::*;

    #[test]
    fn command_errors_should_reach_the_frontend_as_one_string_with_every_cause() {
        let json = |err: CommandError| serde_json::to_string(&err).expect("a string serializes");
        let nested = anyhow!("permission denied")
            .context("could not create recording.mov")
            .context("could not start capture");
        assert_eq!(
            json(nested.into()),
            r#""could not start capture: could not create recording.mov: permission denied""#
        );
        assert_eq!(
            json(std::io::Error::other("disk full").into()),
            r#""disk full""#
        );
        fn not_recording() -> CmdResult {
            None::<()>.context("not recording")?;
            Ok(())
        }
        assert_eq!(json(not_recording().unwrap_err()), r#""not recording""#);
    }

    const FAST: Duration = Duration::from_millis(1);

    /// Long enough for a loop to tick many times, or to notice it should end.
    fn settle() {
        thread::sleep(Duration::from_millis(40));
    }

    /// A tick that counts its calls and answers `keep_going`.
    fn counter(keep_going: bool) -> (Arc<AtomicUsize>, impl FnMut() -> bool + Send + 'static) {
        let count = Arc::new(AtomicUsize::new(0));
        let ticks = Arc::clone(&count);
        (count, move || {
            ticks.fetch_add(1, Ordering::SeqCst);
            keep_going
        })
    }

    #[test]
    fn poller_should_tick_until_started_again_or_stopped() {
        static POLLER: Poller = Poller::new();
        let (old, old_tick) = counter(true);
        let (new, new_tick) = counter(true);
        POLLER.start(FAST, old_tick);
        POLLER.start(FAST, new_tick);
        settle();
        let old_after_restart = old.load(Ordering::SeqCst);
        settle();
        assert_eq!(old.load(Ordering::SeqCst), old_after_restart);
        assert!(new.load(Ordering::SeqCst) > 1);
        POLLER.stop();
        settle();
        let new_after_stop = new.load(Ordering::SeqCst);
        settle();
        assert_eq!(new.load(Ordering::SeqCst), new_after_stop);
    }

    #[test]
    fn poller_should_end_when_tick_says_so() {
        static POLLER: Poller = Poller::new();
        let (count, tick) = counter(false);
        POLLER.start(FAST, tick);
        settle();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
