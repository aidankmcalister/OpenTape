//! Running AppKit code the way AppKit requires: on the main thread, with its exceptions caught.
//!
//! AppKit reports misuse by throwing Objective-C exceptions. Rust can't unwind through them, so
//! one that isn't caught aborts the app. Every AppKit call goes through [`catch`], usually by way
//! of [`run`] or [`super::window::with_ns_window`].

use std::{panic::AssertUnwindSafe, sync::mpsc};

use anyhow::{Context, Result, anyhow};
use objc2::{MainThreadMarker, exception};
use tauri::AppHandle;

/// Runs `job`, turning an Objective-C exception it throws into an error. Works on any thread.
pub(crate) fn catch<R>(job: impl FnOnce() -> R) -> Result<R> {
    exception::catch(AssertUnwindSafe(job)).map_err(|thrown| anyhow!("macOS refused: {thrown:?}"))
}

/// Runs `job` on the main thread, waits for it, and returns what it returned.
///
/// Called on the main thread, it runs `job` right away: queueing it there and then waiting
/// would block the very thread that has to run it.
pub(crate) fn run<R: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce(MainThreadMarker) -> R + Send + 'static,
) -> Result<R> {
    if let Some(main_thread) = MainThreadMarker::new() {
        return catch(|| job(main_thread));
    }
    let (done_tx, done_rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = MainThreadMarker::new()
            .context("Tauri ran a main-thread job elsewhere")
            .and_then(|main_thread| catch(|| job(main_thread)));
        // Can't fail: `run` is waiting on the other end.
        let _ = done_tx.send(result);
    })?;
    // An error here means the app quit before the job ran, which dropped it.
    done_rx
        .recv()
        .context("the app quit before macOS could do it")?
}
