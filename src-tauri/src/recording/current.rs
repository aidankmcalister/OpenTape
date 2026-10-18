//! The recording you've just made, kept between the preview and the editor until it's closed.

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use crate::util::lock;

/// The recording you've just made. It waits in app storage while the preview and then the editor
/// show it. Saving exports an `.mp4` elsewhere; closing deletes this copy either way.
#[derive(Default)]
pub(crate) struct CurrentRecording(Mutex<Option<Current>>);

struct Current {
    video_path: PathBuf,
    saved_to: Option<PathBuf>,
}

impl CurrentRecording {
    pub(crate) fn video_path(&self) -> Option<PathBuf> {
        self.slot()
            .as_ref()
            .map(|current| current.video_path.clone())
    }

    /// Where it was saved, if it's been saved and the file is still there.
    pub(crate) fn saved_to(&self) -> Option<PathBuf> {
        let saved_to = self.slot().as_ref()?.saved_to.clone()?;
        saved_to.exists().then_some(saved_to)
    }

    pub(crate) fn mark_saved(&self, path: PathBuf) {
        if let Some(current) = self.slot().as_mut() {
            current.saved_to = Some(path);
        }
    }

    /// Deletes the recording's folder in app storage, if there's a recording.
    pub(crate) fn discard(&self) -> Result<(), String> {
        let Some(current) = self.slot().take() else {
            return Ok(());
        };
        let Some(folder) = current.video_path.parent() else {
            return Ok(());
        };
        std::fs::remove_dir_all(folder)
            .map_err(|err| format!("could not delete {}: {err}", folder.display()))
    }

    pub(super) fn keep(&self, video_path: PathBuf) {
        *self.slot() = Some(Current {
            video_path,
            saved_to: None,
        });
    }

    fn slot(&self) -> MutexGuard<'_, Option<Current>> {
        lock(&self.0)
    }
}
