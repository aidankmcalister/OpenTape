//! Small helpers shared across the app.

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Locks `mutex`, carrying on with its data even if another thread panicked while holding it.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs blocking work off the main thread and turns errors into readable strings.
pub(crate) async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| format!("{err:#}"))
}
