//! The recording preview: after you stop, a thumbnail of the recording waits in the bottom-left
//! corner, like Screen Studio's quick share, and follows you between displays. From it you can
//! save the recording to Downloads, copy it, open it in the editor, or close it.
//!
//! One step shows at a time: the record bar, then the preview, then the editor. The bar steps
//! aside while the preview shows and comes back when it closes.

use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use anyhow::{Context, Result, ensure};
use objc2_app_kit::NSPopUpMenuWindowLevel;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use ts_rs::TS;

use super::bar;
use super::follow::{self, Anchor};
use super::pointer::{self, CHECK_EVERY};
use crate::error::CmdResult;
use crate::export;
use crate::geometry::{Point, page_point};
use crate::macos::alert::{self, Alert, Choice};
use crate::macos::keys::{self, Key};
use crate::macos::window as macos_window;
use crate::macos::{main_thread, pasteboard};
use crate::recording::CurrentRecording;
use crate::util::{Poller, lock, run_blocking};

pub(crate) const LABEL: &str = "preview";

/// Watches the pointer while the preview shows.
static POINTER_LOOP: Poller = Poller::new();
/// Where the page was last told the pointer is. The preview holds its keys while it's `Some`.
static REPORTED: Mutex<Option<Point>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
struct Shown {
    video_path: String,
}

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    super::never_close(&window);
    macos_window::with_ns_window(&window, |ns_window| {
        macos_window::float_panel(ns_window, NSPopUpMenuWindowLevel);
    })?;
    Ok(())
}

pub(crate) fn show(app: &AppHandle, video_path: &str) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let shown = Shown {
        video_path: video_path.to_string(),
    };
    // The bar steps aside while the preview shows.
    bar::hide(app);
    // Both fail only while the app quits.
    let _ = app.emit_to(LABEL, "preview-show", shown);
    let _ = macos_window::with_ns_window(&window, |ns_window| {
        follow::place_on_pointer_screen(ns_window, Anchor::BottomLeft);
        ns_window.orderFrontRegardless();
    });
    watch_pointer(window);
}

pub(crate) fn hide(app: &AppHandle) {
    POINTER_LOOP.stop();
    super::hide(app, LABEL);
    // Queued behind the hide and any check still in flight, so the keys are always given back.
    // Fails only while the app quits, which gives them back anyway.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || report(&handle, None));
}

/// E, ⌘C and ⌘S while the pointer is over the preview. The page runs them, as if clicked.
pub(crate) fn on_key(app: &AppHandle, key: Key) {
    let action = match key {
        Key::Edit => "edit",
        Key::Copy => "copy",
        Key::Save => "save",
        Key::Escape | Key::Enter | Key::Tab => return,
    };
    // Fails only once the preview is gone, and then there's nothing to act on.
    let _ = app.emit_to(LABEL, "preview-key", action);
}

/// Saves the recording to Downloads as an `.mp4` named `name`, and returns where.
#[tauri::command]
pub(crate) async fn save_recording(app: AppHandle, name: String) -> CmdResult<String> {
    let path = save(&app, &name).await?;
    Ok(path.display().to_string())
}

/// Puts the recording on the clipboard as an `.mp4` named `name`.
#[tauri::command]
pub(crate) async fn copy_recording(app: AppHandle, name: String) -> CmdResult {
    let video = current_video(&app)?;
    let copies = app.path().app_cache_dir()?.join("copies");
    let output = copies.join(export::file_name(&name));
    let exported = output.clone();
    run_blocking(move || {
        std::fs::create_dir_all(&copies)?;
        export::to_mp4(&video, &exported)
    })
    .await?;
    main_thread::run(&app, move |_| pasteboard::copy_file(&output))??;
    Ok(())
}

/// Opens Finder with the saved `.mp4` selected. Async, so the main thread doesn't wait for Finder.
#[tauri::command]
pub(crate) async fn show_saved_in_finder(current: State<'_, CurrentRecording>) -> CmdResult {
    let saved_to = current.saved_to().context("the recording isn't saved")?;
    run_blocking(move || {
        let status = Command::new("/usr/bin/open")
            .arg("-R")
            .arg(&saved_to)
            .status()
            .context("could not open Finder")?;
        ensure!(
            status.success(),
            "Finder could not show {}",
            saved_to.display()
        );
        Ok(())
    })
    .await?;
    Ok(())
}

/// The ×: closes the preview, asking first to save or delete an unsaved recording.
#[tauri::command]
pub(crate) async fn close_preview(app: AppHandle, name: String) -> CmdResult {
    let current = app.state::<CurrentRecording>();
    if current.saved_to().is_none() {
        let asking = app.clone();
        let choice = tauri::async_runtime::spawn_blocking(move || {
            alert::ask(
                &asking,
                Alert {
                    title: "Save this recording before closing, or delete it?",
                    message: "Saving puts an .mp4 in your Downloads folder.",
                    first: "Save and close",
                    second: Some("Delete and close"),
                },
            )
        })
        .await?;
        match choice {
            Choice::Cancel => return Ok(()),
            Choice::First => {
                save(&app, &name).await?;
            }
            Choice::Second => {}
        }
    }
    hide(&app);
    bar::show(&app);
    current.discard()?;
    Ok(())
}

async fn save(app: &AppHandle, name: &str) -> Result<PathBuf> {
    let current = app.state::<CurrentRecording>();
    if let Some(saved_to) = current.saved_to() {
        return Ok(saved_to);
    }
    let video = current_video(app)?;
    let downloads = app.path().download_dir()?;
    let output = export::free_path(&downloads, name, Path::exists);
    let exported = output.clone();
    run_blocking(move || export::to_mp4(&video, &exported)).await?;
    current.mark_saved(output.clone());
    Ok(output)
}

fn current_video(app: &AppHandle) -> Result<PathBuf> {
    app.state::<CurrentRecording>()
        .video_path()
        .context("there's no recording")
}

/// While the preview shows: tells the page where the pointer is over it, and follows clicks to
/// other displays. A page in an inactive macOS window gets no mouse moves, so Rust tells it
/// instead. The main thread is only asked when the pointer moved or clicked.
fn watch_pointer(window: WebviewWindow) {
    let mut watch = pointer::Watch::default();
    POINTER_LOOP.start(CHECK_EVERY, move || {
        let change = watch.update(pointer::now());
        if !change.moved && !change.clicked {
            return true;
        }
        let app = window.app_handle().clone();
        macos_window::with_ns_window(&window, move |ns_window| {
            if change.clicked {
                follow::follow(ns_window, Anchor::BottomLeft);
            }
            let at = ns_window
                .isVisible()
                .then(|| {
                    page_point(
                        ns_window.mouseLocationOutsideOfEventStream(),
                        ns_window.frame().size,
                    )
                })
                .flatten();
            report(&app, at);
        })
        .is_ok()
    });
}

/// Sends `preview-pointer` when the spot changed: where the pointer is over the preview, or
/// `None` when it's elsewhere. The preview's keys are taken while the pointer is over it, and
/// given back when it leaves.
fn report(app: &AppHandle, at: Option<Point>) {
    let was = std::mem::replace(&mut *lock(&REPORTED), at);
    if was == at {
        return;
    }
    // Fails only once the preview is gone, and then there's no page to tell.
    let _ = app.emit_to(LABEL, "preview-pointer", at);
    if at.is_some() != was.is_some() {
        let keys = if at.is_some() {
            keys::capture(app, keys::PREVIEW)
        } else {
            keys::release(app, keys::PREVIEW)
        };
        // Without the keys, the preview's buttons still work.
        if let Err(err) = keys {
            eprintln!("preview keys: {err}");
        }
    }
}
