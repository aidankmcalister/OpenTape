use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::capture::{EVENTS_FILE, META_FILE};
use crate::current_recording::{CurrentRecording, PROJECT_FILE, is_video};

const VIDEO_VAR: &str = "EDIT_VIDEO";
const TEST_CLIP: &str = "Screen Recorder test clip";

pub(crate) fn open_editor_if_asked(app: &AppHandle) -> bool {
    let Ok(choice) = std::env::var(VIDEO_VAR) else {
        return false;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = open_editor(&app, &choice) {
            log::error!("could not open the editor on {choice:?}: {err:#}");
        }
    });
    true
}

fn open_editor(app: &AppHandle, choice: &str) -> Result<()> {
    let current = app.state::<CurrentRecording>();
    let downloads = app.path().download_dir()?;
    let source = match choice {
        "latest" => newest_video(&downloads)?,
        "test" => downloads.join(TEST_CLIP).join("recording.mov"),
        path => PathBuf::from(path),
    };
    let stem = source
        .file_stem()
        .context("the video path has no file name")?;
    let name = if choice == "test" {
        TEST_CLIP.to_string()
    } else {
        stem.to_string_lossy().into_owned()
    };
    let folder = current.named_folder(&name);
    std::fs::create_dir_all(&folder)?;
    for log in [EVENTS_FILE, META_FILE] {
        let from = source.with_file_name(log);
        if from.exists() && !folder.join(log).exists() {
            std::fs::copy(&from, folder.join(log))?;
        }
    }
    let name = source
        .file_name()
        .context("the video path has no file name")?;
    let copy = folder.join(name);
    if !copy.exists() {
        std::fs::copy(&source, &copy)
            .with_context(|| format!("could not copy {}", source.display()))?;
    }
    let project = folder.join(PROJECT_FILE);
    if project.exists() {
        std::fs::remove_file(project)?;
    }
    current.keep(app, copy)?;
    current.edit(app)
}

fn newest_video(folder: &Path) -> Result<PathBuf> {
    let mut newest = None;
    for entry in std::fs::read_dir(folder)? {
        let path = entry?.path();
        if !is_video(&path) {
            continue;
        }
        let is_recording = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("Screen Recording"));
        let rank = (is_recording, path.metadata()?.modified()?);
        if newest.as_ref().is_none_or(|(best, _)| rank > *best) {
            newest = Some((rank, path));
        }
    }
    newest
        .map(|(_, path)| path)
        .with_context(|| format!("no .mp4 or .mov in {}", folder.display()))
}
