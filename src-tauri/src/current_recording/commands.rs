use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, ensure};
use tauri::{AppHandle, Manager, State};

use super::{CurrentRecording, CursorLog, KeptRecording, Shell, ShownRecording, Window};
use crate::PageEvent;
use crate::export::{ExportLayout, ExportOptions};
use crate::macos::{self, Alert, Choice};
use crate::util::{CmdResult, run_blocking};
use crate::windows::{bar, editor, preview};

impl Shell for AppHandle {
    fn ask(&self, alert: Alert) -> Choice {
        macos::ask(self, alert)
    }

    fn trash(&self, folder: &Path) -> Result<()> {
        macos::trash(folder)
    }

    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()> {
        match from {
            Window::Bar => bar::WINDOW.hide(self),
            Window::Preview => preview::WINDOW.hide(self),
            Window::Editor => editor::hide(self),
        }
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

#[tauri::command]
pub(crate) async fn save_recording(app: AppHandle) -> CmdResult<String> {
    let path = run_blocking(move || app.state::<CurrentRecording>().save()).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) async fn export_recording(
    app: AppHandle,
    layout: ExportLayout,
    options: ExportOptions,
) -> CmdResult<String> {
    let handle = app.clone();
    let to_clipboard = options.to_clipboard;
    let path = run_blocking(move || {
        handle
            .state::<CurrentRecording>()
            .export(&layout, &options, |progress| {
                let _ = PageEvent::ExportProgress(progress).send_to(&handle, editor::LABEL);
            })
    })
    .await?;
    if to_clipboard {
        macos::put_file_on_clipboard(&app, path.clone())?;
    }
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) async fn copy_recording(app: AppHandle) -> CmdResult {
    let handle = app.clone();
    let copy = run_blocking(move || handle.state::<CurrentRecording>().export_copy()).await?;
    macos::put_file_on_clipboard(&app, copy)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn show_saved_in_finder(current: State<'_, CurrentRecording>) -> CmdResult {
    let saved_to = current.saved_to().context("the recording isn't saved")?;
    run_blocking(move || reveal(&saved_to)).await?;
    Ok(())
}

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

#[tauri::command]
pub(crate) async fn kept_recordings(app: AppHandle) -> CmdResult<Vec<KeptRecording>> {
    Ok(run_blocking(move || app.state::<CurrentRecording>().kept_recordings()).await?)
}

#[tauri::command]
pub(crate) async fn reopen_recording(app: AppHandle, folder: String) -> CmdResult {
    run_blocking(move || app.state::<CurrentRecording>().reopen(&app, &folder)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn trash_recording(app: AppHandle, folder: String) -> CmdResult {
    run_blocking(move || app.state::<CurrentRecording>().trash(&app, &folder)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn show_recording_in_finder(app: AppHandle, folder: String) -> CmdResult {
    let path = app.state::<CurrentRecording>().stored(&folder)?;
    run_blocking(move || reveal(&path)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn show_all_recordings(app: AppHandle) -> CmdResult {
    let storage = app.state::<CurrentRecording>().folders.storage.clone();
    run_blocking(move || {
        std::fs::create_dir_all(&storage)?;
        let status = Command::new("/usr/bin/open")
            .arg(&storage)
            .status()
            .context("could not open Finder")?;
        ensure!(
            status.success(),
            "Finder could not open {}",
            storage.display()
        );
        Ok(())
    })
    .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn cursor_log(app: AppHandle) -> CmdResult<Option<CursorLog>> {
    Ok(run_blocking(move || app.state::<CurrentRecording>().cursor_log()).await?)
}

#[tauri::command]
pub(crate) fn load_project(current: State<'_, CurrentRecording>) -> CmdResult<Option<String>> {
    Ok(current.load_project()?)
}

#[tauri::command]
pub(crate) async fn save_project(app: AppHandle, json: String) -> CmdResult {
    run_blocking(move || app.state::<CurrentRecording>().save_project(&json)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) fn editor_recording(current: State<'_, CurrentRecording>) -> Option<ShownRecording> {
    current.shown()
}
