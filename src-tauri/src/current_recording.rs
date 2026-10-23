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

pub(crate) trait Shell {
    fn ask(&self, alert: Alert) -> Choice;
    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()>;
}

pub(crate) struct Folders {
    pub storage: PathBuf,
    pub downloads: PathBuf,
    pub copies: PathBuf,
}

pub(crate) struct CurrentRecording {
    folders: Folders,
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
            kept: Mutex::new(None),
        }
    }

    pub(crate) fn new_folder(&self) -> PathBuf {
        let name = chrono::Local::now().format(NAME_FORMAT).to_string();
        self.folders.storage.join(name)
    }

    pub(crate) fn keep(&self, shell: &impl Shell, video_path: PathBuf) -> Result<()> {
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

    fn save(&self) -> Result<PathBuf> {
        if let Some(saved_to) = self.saved_to() {
            return Ok(saved_to);
        }
        let (video, export_name) = self.video()?;
        let output = free_path(&self.folders.downloads, &export_name, "mp4", Path::exists);
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
            free_path(
                &self.folders.downloads,
                &export_name,
                extension,
                Path::exists,
            )
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
        if self.saved_to().is_none() {
            match shell.ask(close_alert(window)) {
                Choice::Cancel => return Ok(()),
                Choice::First if window == Window::Preview => {
                    self.save()?;
                }
                Choice::First | Choice::Second => {}
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

fn close_alert(window: Window) -> Alert {
    if window == Window::Editor {
        Alert {
            title: "Delete this recording and close?",
            message: "It hasn't been saved, and exporting from the editor isn't ready yet.",
            first: "Delete and close",
            second: None,
        }
    } else {
        Alert {
            title: "Save this recording before closing, or delete it?",
            message: "Saving puts an .mp4 in your Downloads folder.",
            first: "Save and close",
            second: Some("Delete and close"),
        }
    }
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
