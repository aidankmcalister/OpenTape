use std::{
    pin::pin,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    task::{self, Poll, Wake, Waker},
    thread::{self, Thread},
    time::{Duration, Instant},
};

use anyhow::ensure;
use objc2::MainThreadMarker;
use serde::{Serialize, Serializer};

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tauri::async_runtime::spawn_blocking(job).await?
}

pub(crate) fn wait<T>(
    what: &str,
    limit: Duration,
    job: impl Future<Output = T>,
) -> anyhow::Result<T> {
    ensure!(
        MainThreadMarker::new().is_none(),
        "{what} can't wait on the main thread"
    );
    let waker = Waker::from(Arc::new(Unpark(thread::current())));
    let mut context = task::Context::from_waker(&waker);
    let mut job = pin!(job);
    let deadline = Instant::now() + limit;
    loop {
        if let Poll::Ready(value) = job.as_mut().poll(&mut context) {
            return Ok(value);
        }
        let left = deadline.saturating_duration_since(Instant::now());
        ensure!(
            !left.is_zero(),
            "{what} took longer than {} seconds",
            limit.as_secs_f64()
        );
        thread::park_timeout(left);
    }
}

struct Unpark(Thread);

impl Wake for Unpark {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

pub(crate) type CmdResult<T = ()> = Result<T, CommandError>;

#[derive(Debug)]
pub(crate) struct CommandError(String);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(format!("{:#}", err.into()))
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

pub(crate) struct Poller {
    generation: AtomicU64,
}

impl Poller {
    pub(crate) const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }

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

    #[test]
    fn wait_should_give_the_answer_or_say_what_took_too_long() {
        let limit = Duration::from_millis(50);
        assert_eq!(
            wait("a ready job", limit, std::future::ready(7)).unwrap(),
            7
        );
        let late = tauri::async_runtime::spawn_blocking(|| {
            thread::sleep(Duration::from_millis(20));
            8
        });
        assert_eq!(
            wait("a late job", Duration::from_secs(5), late)
                .unwrap()
                .unwrap(),
            8
        );
        let started = Instant::now();
        let stuck = wait("starting the capture", limit, std::future::pending::<()>());
        assert!(started.elapsed() >= limit);
        assert_eq!(
            stuck.unwrap_err().to_string(),
            "starting the capture took longer than 0.05 seconds"
        );
    }

    const FAST: Duration = Duration::from_millis(1);

    fn settle() {
        thread::sleep(Duration::from_millis(40));
    }

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
