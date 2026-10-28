use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use ts_rs::TS;

use crate::capture::{EVENTS_FILE, META_FILE, VIDEO_FILE};
use crate::export::{self, ExportLayout, ExportOptions};
use crate::macos::{Alert, Choice};
use crate::util::lock;

const NAME_FORMAT: &str = "%Y-%m-%d %H.%M.%S";
pub(crate) const PROJECT_FILE: &str = "project.json";
pub(crate) const PICTURE_TYPES: [&str; 5] = ["png", "jpg", "jpeg", "heic", "webp"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Window {
    Bar,
    Preview,
    Editor,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ShownRecording {
    video_path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct CursorLog {
    meta: String,
    events: String,
}

pub(crate) trait Shell {
    fn ask(&self, alert: Alert) -> Choice;
    fn export_and_close(&self) -> Result<()>;
    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()>;
}

pub(crate) struct Folders {
    pub storage: PathBuf,
    pub downloads: PathBuf,
    pub copies: PathBuf,
}

pub(crate) struct CurrentRecording {
    folders: Folders,
    save_folder: Mutex<Option<PathBuf>>,
    kept: Mutex<Option<Kept>>,
}

struct Kept {
    video_path: PathBuf,
    name: String,
    saved_to: Option<PathBuf>,
    window: Window,
}

impl Kept {
    fn shown(&self) -> ShownRecording {
        ShownRecording {
            video_path: self.video_path.display().to_string(),
            name: self.name.clone(),
        }
    }
}

impl CurrentRecording {
    pub(crate) fn new(folders: Folders) -> Self {
        Self {
            folders,
            save_folder: Mutex::new(None),
            kept: Mutex::new(None),
        }
    }

    pub(crate) fn set_save_folder(&self, folder: Option<PathBuf>) {
        *lock(&self.save_folder) = folder;
    }

    fn output_folder(&self) -> PathBuf {
        lock(&self.save_folder)
            .clone()
            .unwrap_or_else(|| self.folders.downloads.clone())
    }

    pub(crate) fn new_folder(&self) -> Result<PathBuf> {
        let name = chrono::Local::now().format(NAME_FORMAT).to_string();
        let folder = self.folders.storage.join(name);
        std::fs::create_dir_all(&folder)
            .with_context(|| format!("could not make {}", folder.display()))?;
        Ok(folder)
    }

    #[cfg(any(debug_assertions, test))]
    pub(crate) fn named_folder(&self, name: &str) -> PathBuf {
        self.folders.storage.join(name)
    }

    pub(crate) fn keep(&self, shell: &impl Shell, video_path: PathBuf) -> Result<()> {
        let folder = video_path
            .parent()
            .context("a recording always sits in its own folder")?;
        let name = folder_name(folder);
        let shown = {
            let mut kept = lock(&self.kept);
            ensure!(kept.is_none(), "another recording is still open");
            kept.insert(Kept {
                video_path,
                name,
                saved_to: None,
                window: Window::Preview,
            })
            .shown()
        };
        shell.switch(Window::Bar, Window::Preview, Some(&shown))
    }

    pub(crate) fn recover(&self, shell: &impl Shell) -> Result<()> {
        let Ok(entries) = std::fs::read_dir(&self.folders.storage) else {
            return Ok(());
        };
        let mut left: Vec<PathBuf> = entries
            .filter_map(|entry| Some(entry.ok()?.path()))
            .filter(|folder| {
                chrono::NaiveDateTime::parse_from_str(&folder_name(folder), NAME_FORMAT).is_ok()
            })
            .collect();
        left.sort();
        let newest = left.pop();
        for folder in left {
            let _ = std::fs::remove_dir_all(folder);
        }
        let Some(folder) = newest else {
            return Ok(());
        };
        let video = Some(folder.join(VIDEO_FILE))
            .filter(|video| video.metadata().is_ok_and(|it| it.len() > 0));
        match video {
            Some(video) => self.keep(shell, video),
            None => std::fs::remove_dir_all(&folder)
                .with_context(|| format!("could not delete {}", folder.display())),
        }
    }

    pub(crate) fn edit(&self, shell: &impl Shell) -> Result<()> {
        let shown = {
            let mut kept = lock(&self.kept);
            let kept = kept.as_mut().context("there's no recording to edit")?;
            kept.window = Window::Editor;
            kept.shown()
        };
        shell.switch(Window::Preview, Window::Editor, Some(&shown))
    }

    fn shown(&self) -> Option<(Window, ShownRecording)> {
        lock(&self.kept)
            .as_ref()
            .map(|kept| (kept.window, kept.shown()))
    }

    fn saved_to(&self) -> Option<PathBuf> {
        let saved_to = lock(&self.kept).as_ref()?.saved_to.clone()?;
        saved_to.exists().then_some(saved_to)
    }

    fn video(&self) -> Result<(PathBuf, String)> {
        let kept = lock(&self.kept);
        let kept = kept.as_ref().context("there's no recording")?;
        let export_name = format!("Screen Recording {}", kept.name.replacen(' ', " at ", 1));
        Ok((kept.video_path.clone(), export_name))
    }

    fn project_path(&self) -> Result<PathBuf> {
        let kept = lock(&self.kept);
        let kept = kept.as_ref().context("there's no recording")?;
        Ok(kept.video_path.with_file_name(PROJECT_FILE))
    }

    fn cursor_log(&self) -> Result<Option<CursorLog>> {
        let folder = self.project_path()?.with_file_name("");
        let read = |name: &str| std::fs::read_to_string(folder.join(name)).ok();
        Ok(read(META_FILE)
            .zip(read(EVENTS_FILE))
            .map(|(meta, events)| CursorLog { meta, events }))
    }

    fn load_project(&self) -> Result<Option<String>> {
        let path = self.project_path()?;
        match std::fs::read_to_string(&path) {
            Ok(json) => Ok(Some(json)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err).with_context(|| format!("could not read {}", path.display())),
        }
    }

    fn save_project(&self, json: &str) -> Result<()> {
        let path = self.project_path()?;
        let draft = path.with_extension("json.part");
        std::fs::write(&draft, json)
            .with_context(|| format!("could not write {}", draft.display()))?;
        std::fs::rename(&draft, &path).with_context(|| format!("could not save {}", path.display()))
    }

    fn add_background(&self, picture: &Path) -> Result<String> {
        let extension = (picture.extension().and_then(|ext| ext.to_str()))
            .map(str::to_lowercase)
            .filter(|ext| PICTURE_TYPES.contains(&ext.as_str()))
            .context("that isn't a PNG, JPEG, HEIC or WebP picture")?;
        let folder = self.project_path()?.with_file_name("");
        let copy = free_path(&folder, "background", &extension, Path::exists);
        std::fs::copy(picture, &copy)
            .with_context(|| format!("could not copy {}", picture.display()))?;
        Ok(folder_name(&copy))
    }

    fn save(&self, to_clipboard: bool) -> Result<PathBuf> {
        match self.saved_to().filter(|_| !to_clipboard) {
            Some(saved_to) => Ok(saved_to),
            None => self.output(to_clipboard, "mp4", export::to_mp4),
        }
    }

    fn export(
        &self,
        layout: &ExportLayout,
        options: &ExportOptions,
        progress: impl Fn(f32),
    ) -> Result<PathBuf> {
        self.output(
            options.to_clipboard,
            options.extension(),
            |video, output| export::export(video, output, layout, options, progress),
        )
    }

    fn output(
        &self,
        to_clipboard: bool,
        extension: &str,
        write: impl FnOnce(&Path, &Path) -> Result<()>,
    ) -> Result<PathBuf> {
        let (video, export_name) = self.video()?;
        let output = if to_clipboard {
            std::fs::create_dir_all(&self.folders.copies)?;
            self.folders.copies.join(file_name(&export_name, extension))
        } else {
            free_path(&self.output_folder(), &export_name, extension, Path::exists)
        };
        write(&video, &output)?;
        if let Some(kept) = lock(&self.kept).as_mut().filter(|_| !to_clipboard) {
            kept.saved_to = Some(output.clone());
        }
        Ok(output)
    }

    pub(crate) fn close(&self, shell: &impl Shell) -> Result<()> {
        let Some(window) = lock(&self.kept).as_ref().map(|kept| kept.window) else {
            return Ok(());
        };
        if self.saved_to().is_none() {
            let is_editor = window == Window::Editor;
            match shell.ask(if is_editor {
                EDITOR_ALERT
            } else {
                PREVIEW_ALERT
            }) {
                Choice::Cancel => return Ok(()),
                Choice::First if is_editor => return shell.export_and_close(),
                Choice::First => {
                    self.save(false)?;
                }
                Choice::Second => {}
            }
        }
        let kept = lock(&self.kept).take();
        shell.switch(window, Window::Bar, None)?;
        let Some(folder) = kept.as_ref().and_then(|kept| kept.video_path.parent()) else {
            return Ok(());
        };
        std::fs::remove_dir_all(folder)
            .with_context(|| format!("could not delete {}", folder.display()))
    }
}

const PREVIEW_ALERT: Alert = Alert {
    title: "Save this recording before closing?",
    message: "The recording isn't kept anywhere else. Saving puts an .mp4 in your save folder.",
    first: "Save and close",
    second: Some("Discard"),
};

const EDITOR_ALERT: Alert = Alert {
    title: "Export this recording before closing?",
    message: "The recording isn't kept anywhere else. Closing without exporting deletes it and your edits.",
    first: "Export and close",
    second: Some("Discard"),
};

pub(crate) fn is_video(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("mov" | "mp4")
    )
}

fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn file_name(name: &str, extension: &str) -> String {
    format!("{}.{extension}", name.replace(['/', ':'], "-"))
}

fn free_path(
    folder: &Path,
    name: &str,
    extension: &str,
    is_taken: impl Fn(&Path) -> bool,
) -> PathBuf {
    let mut path = folder.join(file_name(name, extension));
    let mut copy_number = 2;
    while is_taken(&path) {
        path = folder.join(file_name(&format!("{name} {copy_number}"), extension));
        copy_number += 1;
    }
    path
}

pub(crate) mod commands;

#[cfg(test)]
mod tests;
