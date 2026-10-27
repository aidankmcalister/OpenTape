use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, ensure};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::{CurrentRecording, CursorLog, PICTURE_TYPES, Shell, ShownRecording, Window};
use crate::PageEvent;
use crate::export::typing::{TypingSpot, TypingStretch};
use crate::export::{ExportLayout, ExportOptions};
use crate::macos::{self, Alert, Choice};
use crate::util::{CmdResult, run_blocking};
use crate::windows::{bar, editor, preview};

impl Shell for AppHandle {
    fn ask(&self, alert: Alert) -> Choice {
        macos::ask(self, alert)
    }

    fn export_and_close(&self) -> Result<()> {
        PageEvent::ExportAndClose.send_to(self, editor::LABEL)?;
        Ok(())
    }

    fn switch(&self, from: Window, to: Window, recording: Option<&ShownRecording>) -> Result<()> {
        match from {
            Window::Bar => bar::WINDOW.hide(self),
            Window::Preview => preview::WINDOW.hide(self),
            Window::Editor => editor::hide(self),
        }
        let _ = PageEvent::CurrentRecording(None).send_to(self, label(from));
        let _ = PageEvent::CurrentRecording(recording.cloned()).send_to(self, label(to));
        show(self, to)
    }
}

pub(crate) fn show_again(app: &AppHandle) -> Result<()> {
    let shown = app.state::<CurrentRecording>().shown();
    show(app, shown.map_or(Window::Bar, |(window, _)| window))
}

fn show(app: &AppHandle, window: Window) -> Result<()> {
    match window {
        Window::Bar => bar::WINDOW.show(app),
        Window::Preview => preview::WINDOW.show(app),
        Window::Editor => editor::show(app)?,
    }
    Ok(())
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
    let path = run_blocking(move || app.state::<CurrentRecording>().save(false)).await?;
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
    let copy = run_blocking(move || handle.state::<CurrentRecording>().save(true)).await?;
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
pub(crate) async fn cursor_log(app: AppHandle) -> CmdResult<Option<CursorLog>> {
    Ok(run_blocking(move || app.state::<CurrentRecording>().cursor_log()).await?)
}

#[tauri::command]
pub(crate) async fn typing_spots(
    app: AppHandle,
    stretches: Vec<TypingStretch>,
) -> CmdResult<Vec<TypingSpot>> {
    let (video, _) = app.state::<CurrentRecording>().video()?;
    Ok(run_blocking(move || crate::export::typing::typing_spots(&video, &stretches)).await?)
}

#[tauri::command]
pub(crate) async fn sound_tracks(app: AppHandle) -> CmdResult<Vec<crate::export::SoundTrack>> {
    let (video, _) = app.state::<CurrentRecording>().video()?;
    Ok(run_blocking(move || crate::export::sound_tracks(&video)).await?)
}

#[tauri::command]
pub(crate) async fn cursor_images() -> CmdResult<Vec<crate::macos::cursor::CursorImage>> {
    Ok(run_blocking(crate::macos::cursor::cursor_images).await?)
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
pub(crate) async fn add_background(
    app: AppHandle,
    path: Option<String>,
) -> CmdResult<Option<String>> {
    let added = run_blocking(move || {
        let picture = match path {
            Some(path) => PathBuf::from(path),
            None => {
                let chosen = (app.dialog().file())
                    .set_title("Choose a background picture")
                    .add_filter("Pictures", &PICTURE_TYPES)
                    .blocking_pick_file();
                let Some(chosen) = chosen else {
                    return Ok(None);
                };
                chosen
                    .into_path()
                    .context("that isn't a file on this Mac")?
            }
        };
        app.state::<CurrentRecording>()
            .add_background(&picture)
            .map(Some)
    })
    .await?;
    Ok(added)
}

#[tauri::command]
pub(crate) fn shown_recording(
    window: tauri::WebviewWindow,
    current: State<'_, CurrentRecording>,
) -> Option<ShownRecording> {
    current
        .shown()
        .filter(|(shown_in, _)| label(*shown_in) == window.label())
        .map(|(_, shown)| shown)
}
