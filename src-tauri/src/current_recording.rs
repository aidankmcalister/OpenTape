//! The current recording: the one you've just made. It waits in app storage while the preview,
//! then the editor, shows it. This module names it, keeps it, saves, copies, edits and closes it,
//! and each of those steps decides which window shows: the bar while there's none, then the
//! preview, then the editor. Closing deletes the copy in app storage, saved or not.

use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::PageEvent;
use crate::export::{self, ExportLayout};
use crate::macos::{self, Alert, Choice};
use crate::util::{CmdResult, lock, run_blocking};
use crate::windows::{bar, editor, preview};

/// A recording's folder is named for when it started, like "2026-10-16 07.41.28", and that's
/// the recording's name too.
const NAME_FORMAT: &str = "%Y-%m-%d %H.%M.%S";

/// The windows that take turns: the bar while there's no recording, then the preview, then the
/// editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Window {
    Bar,
    Preview,
    Editor,
}

/// The recording as the preview and the editor get it, or `null` once it's gone from them.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ShownRecording {
    video_path: String,
    /// When it started, like "2026-10-16 07.41.28".
    name: String,
}

/// The windows and the alert the current recording drives. `AppHandle` is the real one; the
/// tests use a fake that writes down what happened.
pub(crate) trait Shell {
    /// Waits for the answer, so it's never called on the main thread.
    fn ask(&self, alert: Alert) -> Choice;
    /// Hides `from` and shows `to`, handing `to`'s page the recording, if there is one.
    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()>;
}

pub(crate) struct Folders {
    /// App storage, where recordings wait until they're closed.
    pub storage: PathBuf,
    pub downloads: PathBuf,
    /// Where Copy puts the `.mp4` it hands the clipboard.
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
    /// The window showing it.
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

    /// A folder in app storage for a recording starting now.
    pub(crate) fn new_folder(&self) -> PathBuf {
        let name = chrono::Local::now().format(NAME_FORMAT).to_string();
        self.folders.storage.join(name)
    }

    /// Keeps a finished recording and shows it in the preview in place of the bar. Refused while
    /// another is open, so that one is never lost; the app can't get there anyway, because the
    /// bar, where recordings start, stays hidden until it closes.
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

    /// Moves the recording from the preview into the editor.
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

    /// Where Save put it, while that file is still there.
    fn saved_to(&self) -> Option<PathBuf> {
        let saved_to = lock(&self.kept).as_ref()?.saved_to.clone()?;
        saved_to.exists().then_some(saved_to)
    }

    /// The video, and what its exports are called, like macOS names its own screen recordings:
    /// "Screen Recording 2026-10-16 at 07.41.28".
    fn video(&self) -> Result<(PathBuf, String)> {
        let kept = lock(&self.kept);
        let kept = kept.as_ref().context("there's no recording")?;
        let export_name = format!("Screen Recording {}", kept.name.replacen(' ', " at ", 1));
        Ok((kept.video_path.clone(), export_name))
    }

    /// Exports it to Downloads as an `.mp4`, unless it's already saved, and returns where.
    /// Blocks until it's done.
    fn save(&self) -> Result<PathBuf> {
        if let Some(saved_to) = self.saved_to() {
            return Ok(saved_to);
        }
        let (video, export_name) = self.video()?;
        let output = free_path(&self.folders.downloads, &export_name, Path::exists);
        to_mp4(&video, &output)?;
        if let Some(kept) = lock(&self.kept).as_mut() {
            kept.saved_to = Some(output.clone());
        }
        Ok(output)
    }

    /// Exports it in `layout` to Downloads as an `.mp4`, named the way Save names its files, and
    /// returns where. Blocks until it's done, calling `progress` with 0 to 1 on the way.
    fn export(&self, layout: &ExportLayout, progress: impl Fn(f32)) -> Result<PathBuf> {
        let (video, export_name) = self.video()?;
        let output = free_path(&self.folders.downloads, &export_name, Path::exists);
        export::export(&video, &output, layout, progress)?;
        Ok(output)
    }

    /// Exports an `.mp4` for the clipboard, and returns where. Blocks until it's done.
    fn export_copy(&self) -> Result<PathBuf> {
        let (video, export_name) = self.video()?;
        std::fs::create_dir_all(&self.folders.copies)?;
        let output = self.folders.copies.join(mp4_name(&export_name));
        to_mp4(&video, &output)?;
        Ok(output)
    }

    /// Closes the window showing it and brings the bar back, then deletes the copy in app
    /// storage. An unsaved recording asks first, and Cancel keeps it. Waits for the answer, so
    /// it's never called on the main thread.
    pub(crate) fn close(&self, shell: &impl Shell) -> Result<()> {
        let Some(window) = lock(&self.kept).as_ref().map(|kept| kept.window) else {
            return Ok(());
        };
        if self.saved_to().is_none() {
            match shell.ask(close_alert(window)) {
                Choice::Cancel => return Ok(()),
                // The preview's first answer is Save and close. The editor can't export yet, so
                // its only answer deletes.
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

/// What closing an unsaved recording asks, by the window it's closed from.
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

/// Turns the recording into an `.mp4` with macOS's own `avconvert`. It's a passthrough: the
/// video is copied as is, so it's quick and loses nothing.
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

/// `name.mp4`, with characters a file name can't hold swapped for dashes.
fn mp4_name(name: &str) -> String {
    format!("{}.mp4", name.replace(['/', ':'], "-"))
}

/// `name.mp4` in `folder`, or `name 2.mp4`, `name 3.mp4` and so on when it's taken, like Finder.
fn free_path(folder: &Path, name: &str, is_taken: impl Fn(&Path) -> bool) -> PathBuf {
    let mut path = folder.join(mp4_name(name));
    let mut copy_number = 2;
    while is_taken(&path) {
        path = folder.join(mp4_name(&format!("{name} {copy_number}")));
        copy_number += 1;
    }
    path
}

impl Shell for AppHandle {
    fn ask(&self, alert: Alert) -> Choice {
        macos::ask(self, alert)
    }

    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()> {
        match from {
            Window::Bar => bar::WINDOW.hide(self),
            Window::Preview => preview::WINDOW.hide(self),
            Window::Editor => editor::hide(self),
        }
        // Both fail only once the page is gone, and then there's no one to tell. The bar's page
        // doesn't listen.
        let _ = PageEvent::CurrentRecording(None).send_to(self, label(from));
        let _ = PageEvent::CurrentRecording(recording.cloned()).send_to(self, label(to));
        match to {
            Window::Bar => bar::WINDOW.show(self),
            Window::Preview => preview::WINDOW.show(self),
            Window::Editor => editor::show(self)?,
        }
        Ok(())
    }
}

fn label(window: Window) -> &'static str {
    match window {
        Window::Bar => bar::LABEL,
        Window::Preview => preview::LABEL,
        Window::Editor => editor::LABEL,
    }
}

/// Saves the recording to Downloads as an `.mp4`, and returns where.
#[tauri::command]
pub(crate) async fn save_recording(app: AppHandle) -> CmdResult<String> {
    let path = run_blocking(move || app.state::<CurrentRecording>().save()).await?;
    Ok(path.display().to_string())
}

/// Exports the recording in `layout`, the look as the page lays it out, to Downloads as an
/// `.mp4`, and returns where. The editor hears `export-progress` on the way.
#[tauri::command]
pub(crate) async fn export_recording(app: AppHandle, layout: ExportLayout) -> CmdResult<String> {
    let path = run_blocking(move || {
        app.state::<CurrentRecording>().export(&layout, |progress| {
            // A missed update only leaves the progress behind; the export carries on.
            let _ = PageEvent::ExportProgress(progress).send_to(&app, editor::LABEL);
        })
    })
    .await?;
    Ok(path.display().to_string())
}

/// Puts the recording on the clipboard as an `.mp4`.
#[tauri::command]
pub(crate) async fn copy_recording(app: AppHandle) -> CmdResult {
    let handle = app.clone();
    let copy = run_blocking(move || handle.state::<CurrentRecording>().export_copy()).await?;
    macos::put_file_on_clipboard(&app, copy)?;
    Ok(())
}

/// Opens Finder with the saved `.mp4` selected. Async, so the main thread doesn't wait for Finder.
#[tauri::command]
pub(crate) async fn show_saved_in_finder(current: State<'_, CurrentRecording>) -> CmdResult {
    let saved_to = current.saved_to().context("the recording isn't saved")?;
    run_blocking(move || reveal(&saved_to)).await?;
    Ok(())
}

/// Opens Finder with an export selected, from the path `export_recording` returned.
#[tauri::command]
pub(crate) async fn show_export_in_finder(path: String) -> CmdResult {
    run_blocking(move || reveal(Path::new(&path))).await?;
    Ok(())
}

fn reveal(path: &Path) -> Result<()> {
    ensure!(path.exists(), "{} isn't there any more", path.display());
    let status = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .context("could not open Finder")?;
    ensure!(status.success(), "Finder could not show {}", path.display());
    Ok(())
}

/// The preview's ×. The editor's close button closes the same way.
#[tauri::command]
pub(crate) async fn close_recording(app: AppHandle) -> CmdResult {
    run_blocking(move || app.state::<CurrentRecording>().close(&app)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) fn edit_recording(app: AppHandle, current: State<'_, CurrentRecording>) -> CmdResult {
    current.edit(&app)?;
    Ok(())
}

/// The recording, for an editor page that loads after it was handed over.
#[tauri::command]
pub(crate) fn editor_recording(current: State<'_, CurrentRecording>) -> Option<ShownRecording> {
    current.shown()
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    /// Answers every alert with `answer`, and writes down the alerts and the window switches.
    struct FakeShell {
        answer: Choice,
        asked: RefCell<Vec<&'static str>>,
        switches: RefCell<Vec<(Window, Window)>>,
    }

    impl FakeShell {
        fn answering(answer: Choice) -> Self {
            Self {
                answer,
                asked: RefCell::default(),
                switches: RefCell::default(),
            }
        }

        fn last_switch(&self) -> (Window, Window) {
            *self.switches.borrow().last().expect("something switched")
        }
    }

    impl Shell for FakeShell {
        fn ask(&self, alert: Alert) -> Choice {
            self.asked.borrow_mut().push(alert.title);
            self.answer
        }

        fn switch(&self, from: Window, to: Window, _: Option<&ShownRecording>) -> Result<()> {
            self.switches.borrow_mut().push((from, to));
            Ok(())
        }
    }

    /// A current recording with a temp folder as app storage, keeping one finished recording.
    fn keeping_one(test: &str, shell: &FakeShell) -> (CurrentRecording, PathBuf) {
        let root = std::env::temp_dir().join(format!("screen-recorder-test-{test}"));
        let _ = std::fs::remove_dir_all(&root);
        let current = CurrentRecording::new(Folders {
            storage: root.join("recordings"),
            downloads: root.join("Downloads"),
            copies: root.join("copies"),
        });
        let folder = current.new_folder();
        std::fs::create_dir_all(&folder).expect("the temp folder can be made");
        let video = folder.join("recording.mov");
        std::fs::write(&video, b"").expect("the temp video can be written");
        current.keep(shell, video).expect("nothing else is open");
        (current, folder)
    }

    const SAVE_OR_DELETE: &str = "Save this recording before closing, or delete it?";

    #[test]
    fn keep_should_show_the_preview_and_refuse_a_second_recording() {
        let shell = FakeShell::answering(Choice::Cancel);
        let (current, folder) = keeping_one("keep", &shell);
        assert_eq!(*shell.switches.borrow(), [(Window::Bar, Window::Preview)]);
        let name = current.shown().expect("it's kept").name;
        assert_eq!(
            folder.file_name().and_then(|name| name.to_str()),
            Some(&*name)
        );
        let second = current.keep(&shell, folder.join("other.mov"));
        assert!(second.is_err());
        assert_eq!(current.shown().expect("still kept").name, name);
        assert_eq!(shell.switches.borrow().len(), 1);
    }

    #[test]
    fn closing_unsaved_should_ask_and_cancel_should_keep_it() {
        let shell = FakeShell::answering(Choice::Cancel);
        let (current, folder) = keeping_one("cancel", &shell);
        current.close(&shell).expect("cancelling is fine");
        assert_eq!(*shell.asked.borrow(), [SAVE_OR_DELETE]);
        assert_eq!(shell.last_switch(), (Window::Bar, Window::Preview));
        assert!(folder.exists());
        assert!(current.shown().is_some());
    }

    #[test]
    fn closing_unsaved_with_delete_should_bring_the_bar_back_and_delete() {
        let shell = FakeShell::answering(Choice::Second);
        let (current, folder) = keeping_one("delete", &shell);
        current.close(&shell).expect("closes");
        assert_eq!(*shell.asked.borrow(), [SAVE_OR_DELETE]);
        assert_eq!(shell.last_switch(), (Window::Preview, Window::Bar));
        assert!(!folder.exists());
        assert!(current.shown().is_none());
    }

    #[test]
    fn closing_saved_should_skip_the_alert_and_delete() {
        // Cancel would keep it, if it were asked.
        let shell = FakeShell::answering(Choice::Cancel);
        let (current, folder) = keeping_one("saved", &shell);
        let saved_to = folder.with_file_name("saved.mp4");
        std::fs::write(&saved_to, b"").expect("the temp export can be written");
        lock(&current.kept).as_mut().expect("kept").saved_to = Some(saved_to);
        current.close(&shell).expect("closes");
        assert!(shell.asked.borrow().is_empty());
        assert!(!folder.exists());
    }

    #[test]
    fn closing_from_the_editor_should_ask_its_own_alert_and_never_save() {
        let shell = FakeShell::answering(Choice::First);
        let (current, folder) = keeping_one("editor", &shell);
        current.edit(&shell).expect("edits");
        assert_eq!(shell.last_switch(), (Window::Preview, Window::Editor));
        current.close(&shell).expect("closes");
        assert_eq!(*shell.asked.borrow(), ["Delete this recording and close?"]);
        assert_eq!(shell.last_switch(), (Window::Editor, Window::Bar));
        assert!(!folder.exists());
        assert!(!current.folders.downloads.exists());
    }

    #[test]
    fn a_failed_delete_should_be_reported_after_the_bar_comes_back() {
        let shell = FakeShell::answering(Choice::Second);
        let (current, folder) = keeping_one("failed-delete", &shell);
        std::fs::remove_dir_all(&folder).expect("the temp folder can be removed");
        let err = current
            .close(&shell)
            .expect_err("there's nothing to delete");
        assert!(format!("{err:#}").starts_with("could not delete"));
        assert_eq!(shell.last_switch(), (Window::Preview, Window::Bar));
        assert!(current.shown().is_none());
    }

    #[test]
    fn names_should_read_like_macos_screen_recordings() {
        let started = chrono::NaiveDate::from_ymd_opt(2026, 10, 16)
            .and_then(|day| day.and_hms_opt(7, 41, 28))
            .expect("a real time");
        let name = started.format(NAME_FORMAT).to_string();
        assert_eq!(name, "2026-10-16 07.41.28");
        let shell = FakeShell::answering(Choice::Cancel);
        let (current, _) = keeping_one("names", &shell);
        lock(&current.kept).as_mut().expect("kept").name = name;
        let (_, export_name) = current.video().expect("kept");
        assert_eq!(export_name, "Screen Recording 2026-10-16 at 07.41.28");
    }

    #[test]
    fn mp4_names_should_be_safe_and_numbered_like_finder_when_taken() {
        assert_eq!(mp4_name("a/b: c"), "a-b- c.mp4");
        let folder = Path::new("/Downloads");
        let taken = [folder.join("Clip.mp4"), folder.join("Clip 2.mp4")];
        let path = free_path(folder, "Clip", |path| taken.iter().any(|t| t == path));
        assert_eq!(path, folder.join("Clip 3.mp4"));
        assert_eq!(free_path(folder, "New", |_| false), folder.join("New.mp4"));
    }
}
