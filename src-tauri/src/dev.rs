use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::current_recording::CurrentRecording;

const VIDEO_VAR: &str = "EDIT_VIDEO";

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
    let current = app.state::<CurrentRecording>();
    if choice == "recording" {
        let folder = current
            .kept_recordings()?
            .into_iter()
            .map(|kept| kept.folder)
            .find(|folder| {
                current
                    .stored(folder)
                    .is_ok_and(|path| path.join("events.jsonl").exists())
            })
            .context("no recording with a cursor log yet; record one first")?;
        return current.reopen(app, &folder);
    }
    let source = if choice == "latest" {
        newest_video(&app.path().download_dir()?)?
    } else {
        PathBuf::from(choice)
    };
    let stem = source
        .file_stem()
        .context("the video path has no file name")?;
    let folder = current.named_folder(&stem.to_string_lossy());
    std::fs::create_dir_all(&folder)?;
    let name = source
        .file_name()
        .context("the video path has no file name")?;
    let copy = folder.join(name);
    if !copy.exists() {
        std::fs::copy(&source, &copy)
            .with_context(|| format!("could not copy {}", source.display()))?;
    }
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
