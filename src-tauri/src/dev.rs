//! A shortcut for working on the editor: `bun run dev:editor` opens it straight away on an
//! existing video, without recording one first. Only in debug builds.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::current_recording::CurrentRecording;

/// The video to open: a path, or `latest` for the newest recording saved to Downloads (or the
/// newest video there, if no recording has been saved yet).
const VIDEO_VAR: &str = "EDIT_VIDEO";

/// Opens the editor if `EDIT_VIDEO` is set, on a copy in app storage: closing the editor deletes
/// the recording's folder, and that must never be the folder the video came from.
pub(crate) fn open_editor_if_asked(app: &AppHandle) {
    let Ok(choice) = std::env::var(VIDEO_VAR) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = open_editor(&app, &choice) {
            eprintln!("could not open the editor on {choice:?}: {err:#}");
        }
    });
}

fn open_editor(app: &AppHandle, choice: &str) -> Result<()> {
    let source = if choice == "latest" {
        newest_video(&app.path().download_dir()?)?
    } else {
        PathBuf::from(choice)
    };
    let current = app.state::<CurrentRecording>();
    let folder = current.new_folder();
    std::fs::create_dir_all(&folder)?;
    let name = source
        .file_name()
        .context("the video path has no file name")?;
    let copy = folder.join(name);
    std::fs::copy(&source, &copy)
        .with_context(|| format!("could not copy {}", source.display()))?;
    current.keep(app, copy)?;
    current.edit(app)
}

fn newest_video(folder: &Path) -> Result<PathBuf> {
    let mut newest = None;
    for entry in std::fs::read_dir(folder)? {
        let path = entry?.path();
        let is_video = matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some("mp4" | "mov")
        );
        if !is_video {
            continue;
        }
        // A saved recording beats any other video: it's what the editor really gets, with a
        // keyframe every half second, where a download might have one every eight.
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
