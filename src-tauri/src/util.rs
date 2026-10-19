//! Small helpers shared across the app.

use std::{
    sync::{
        Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

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
    /// [`Poller::stop`] or until `tick` returns `false`.
    pub(crate) fn start(
        &'static self,
        every: Duration,
        mut tick: impl FnMut() -> bool + Send + 'static,
    ) {
        let mine = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        thread::spawn(move || {
            while self.generation.load(Ordering::SeqCst) == mine && tick() {
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
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    const FAST: Duration = Duration::from_millis(1);
    /// Long enough for a loop to tick many times, or to notice it should end.
    const SETTLE: Duration = Duration::from_millis(40);

    fn counter() -> (Arc<AtomicUsize>, impl FnMut() -> bool + Send + 'static) {
        let count = Arc::new(AtomicUsize::new(0));
        let ticks = Arc::clone(&count);
        (count, move || {
            ticks.fetch_add(1, Ordering::SeqCst);
            true
        })
    }

    #[test]
    fn poller_should_tick_until_stopped() {
        static POLLER: Poller = Poller::new();
        let (count, tick) = counter();
        POLLER.start(FAST, tick);
        thread::sleep(SETTLE);
        POLLER.stop();
        thread::sleep(SETTLE);
        let after_stop = count.load(Ordering::SeqCst);
        assert!(after_stop > 1);
        thread::sleep(SETTLE);
        assert_eq!(count.load(Ordering::SeqCst), after_stop);
    }

    #[test]
    fn poller_should_end_the_old_loop_when_started_again() {
        static POLLER: Poller = Poller::new();
        let (old, old_tick) = counter();
        let (new, new_tick) = counter();
        POLLER.start(FAST, old_tick);
        POLLER.start(FAST, new_tick);
        thread::sleep(SETTLE);
        let old_after_restart = old.load(Ordering::SeqCst);
        thread::sleep(SETTLE);
        assert_eq!(old.load(Ordering::SeqCst), old_after_restart);
        assert!(new.load(Ordering::SeqCst) > 1);
        POLLER.stop();
    }

    #[test]
    fn poller_should_end_when_tick_says_so() {
        static POLLER: Poller = Poller::new();
        let count = Arc::new(AtomicUsize::new(0));
        let ticks = Arc::clone(&count);
        POLLER.start(FAST, move || {
            ticks.fetch_add(1, Ordering::SeqCst);
            false
        });
        thread::sleep(SETTLE);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
