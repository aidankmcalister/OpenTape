use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use ts_rs::TS;

use crate::export::{self, ExportLayout, ExportOptions};
use crate::macos::{Alert, Choice};
use crate::util::lock;

const NAME_FORMAT: &str = "%Y-%m-%d %H.%M.%S";
const PROJECT_FILE: &str = "project.json";
const RECORDING_MARKER: &str = "recording-in-progress";

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
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct KeptRecording {
    folder: String,
    modified_ms: f64,
    size_bytes: f64,
    is_edited: bool,
    is_recovered: bool,
}

pub(crate) trait Shell {
    fn ask(&self, alert: Alert) -> Choice;
    fn trash(&self, folder: &Path) -> Result<()>;
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
        std::fs::write(folder.join(RECORDING_MARKER), b"")?;
        Ok(folder)
    }

    pub(crate) fn named_folder(&self, name: &str) -> PathBuf {
        self.folders.storage.join(name)
    }

    pub(crate) fn keep(&self, shell: &impl Shell, video_path: PathBuf) -> Result<()> {
        if let Some(folder) = video_path.parent() {
            let _ = std::fs::remove_file(folder.join(RECORDING_MARKER));
        }
        let shown = {
            let mut kept = lock(&self.kept);
            ensure!(kept.is_none(), "another recording is still open");
            let name = video_path
                .parent()
                .and_then(Path::file_name)
                .context("a recording always sits in its own folder")?
                .to_string_lossy()
                .into_owned();
            let new = kept.insert(Kept {
                video_path,
                name,
                saved_to: None,
                window: Window::Preview,
            });
            new.shown()
        };
        shell.switch(Window::Bar, Window::Preview, Some(&shown))
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

    pub(crate) fn kept_recordings(&self) -> Result<Vec<KeptRecording>> {
        let Ok(entries) = std::fs::read_dir(&self.folders.storage) else {
            return Ok(Vec::new());
        };
        let mut recordings = Vec::new();
        for entry in entries {
            let folder = entry?.path();
            if video_in(&folder).is_none() {
                continue;
            }
            let modified = folder.metadata()?.modified()?;
            let size_bytes = std::fs::read_dir(&folder)?
                .filter_map(|file| file.ok()?.metadata().ok())
                .map(|metadata| metadata.len() as f64)
                .sum();
            recordings.push(KeptRecording {
                folder: folder_name(&folder),
                modified_ms: modified.duration_since(std::time::UNIX_EPOCH)?.as_millis() as f64,
                size_bytes,
                is_edited: folder.join(PROJECT_FILE).exists(),
                is_recovered: folder.join(RECORDING_MARKER).exists(),
            });
        }
        recordings.sort_by(|a, b| {
            (b.is_recovered, b.modified_ms)
                .partial_cmp(&(a.is_recovered, a.modified_ms))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(recordings)
    }

    pub(crate) fn reopen(&self, shell: &impl Shell, folder: &str) -> Result<()> {
        let path = self.stored(folder)?;
        let video_path = video_in(&path).context("that recording has no video")?;
        let shown = {
            let mut kept = lock(&self.kept);
            ensure!(kept.is_none(), "another recording is still open");
            kept.insert(Kept {
                video_path,
                name: folder.to_string(),
                saved_to: None,
                window: Window::Editor,
            })
            .shown()
        };
        shell.switch(Window::Bar, Window::Editor, Some(&shown))
    }

    pub(crate) fn trash(&self, shell: &impl Shell, folder: &str) -> Result<()> {
        let path = self.stored(folder)?;
        let is_open = lock(&self.kept)
            .as_ref()
            .is_some_and(|kept| kept.video_path.parent() == Some(path.as_path()));
        ensure!(
            !is_open,
            "close this recording before moving it to the Trash"
        );
        shell.trash(&path)
    }

    pub(crate) fn trash_older_than(&self, shell: &impl Shell, days: u32) -> Result<usize> {
        let cutoff = std::time::SystemTime::now()
            - std::time::Duration::from_secs(u64::from(days) * 24 * 60 * 60);
        let cutoff_ms = cutoff.duration_since(std::time::UNIX_EPOCH)?.as_millis() as f64;
        let old: Vec<_> = self
            .kept_recordings()?
            .into_iter()
            .filter(|kept| kept.modified_ms < cutoff_ms)
            .collect();
        let mut trashed = 0;
        for kept in old {
            if self.trash(shell, &kept.folder).is_ok() {
                trashed += 1;
            }
        }
        Ok(trashed)
    }

    pub(crate) fn stored(&self, folder: &str) -> Result<PathBuf> {
        let is_name =
            !folder.is_empty() && !folder.contains(['/', '\\']) && folder != "." && folder != "..";
        ensure!(is_name, "{folder:?} isn't a recording");
        let path = self.folders.storage.join(folder);
        ensure!(path.is_dir(), "{folder} isn't in your recordings");
        Ok(path)
    }

    fn shown(&self) -> Option<ShownRecording> {
        lock(&self.kept).as_ref().map(Kept::shown)
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

    fn save(&self) -> Result<PathBuf> {
        if let Some(saved_to) = self.saved_to() {
            return Ok(saved_to);
        }
        let (video, export_name) = self.video()?;
        let output = free_path(&self.output_folder(), &export_name, "mp4", Path::exists);
        to_mp4(&video, &output)?;
        if let Some(kept) = lock(&self.kept).as_mut() {
            kept.saved_to = Some(output.clone());
        }
        Ok(output)
    }

    fn export(
        &self,
        layout: &ExportLayout,
        options: &ExportOptions,
        progress: impl Fn(f32),
    ) -> Result<PathBuf> {
        let (video, export_name) = self.video()?;
        let extension = options.extension();
        let output = if options.to_clipboard {
            std::fs::create_dir_all(&self.folders.copies)?;
            self.folders.copies.join(file_name(&export_name, extension))
        } else {
            free_path(&self.output_folder(), &export_name, extension, Path::exists)
        };
        export::export(&video, &output, layout, options, progress)?;
        Ok(output)
    }

    fn export_copy(&self) -> Result<PathBuf> {
        let (video, export_name) = self.video()?;
        std::fs::create_dir_all(&self.folders.copies)?;
        let output = self.folders.copies.join(file_name(&export_name, "mp4"));
        to_mp4(&video, &output)?;
        Ok(output)
    }

    pub(crate) fn close(&self, shell: &impl Shell) -> Result<()> {
        let Some(window) = lock(&self.kept).as_ref().map(|kept| kept.window) else {
            return Ok(());
        };
        let mut is_deleting = false;
        if window == Window::Preview && self.saved_to().is_none() {
            match shell.ask(CLOSE_ALERT) {
                Choice::Cancel => return Ok(()),
                Choice::First => {
                    self.save()?;
                }
                Choice::Second => is_deleting = true,
            }
        }
        let kept = lock(&self.kept).take();
        shell.switch(window, Window::Bar, None)?;
        if !is_deleting {
            return Ok(());
        }
        let Some(folder) = kept.as_ref().and_then(|kept| kept.video_path.parent()) else {
            return Ok(());
        };
        std::fs::remove_dir_all(folder)
            .with_context(|| format!("could not delete {}", folder.display()))
    }
}

const CLOSE_ALERT: Alert = Alert {
    title: "Save this recording before closing, or delete it?",
    message: "Saving puts an .mp4 in your Downloads folder.",
    first: "Save and close",
    second: Some("Delete and close"),
};

fn video_in(folder: &Path) -> Option<PathBuf> {
    std::fs::read_dir(folder).ok()?.find_map(|entry| {
        let path = entry.ok()?.path();
        let extension = path.extension()?.to_str()?;
        matches!(extension, "mov" | "mp4").then_some(path)
    })
}

fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn to_mp4(video: &Path, output: &Path) -> Result<()> {
    let avconvert = Command::new("/usr/bin/avconvert")
        .args(["--preset", "PresetPassthrough", "--replace", "--source"])
        .arg(video)
        .arg("--output")
        .arg(output)
        .output()
        .context("could not start avconvert")?;
    if !avconvert.status.success() {
        let stderr = String::from_utf8_lossy(&avconvert.stderr);
        bail!("could not make the .mp4: {}", stderr.trim());
    }
    Ok(())
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
