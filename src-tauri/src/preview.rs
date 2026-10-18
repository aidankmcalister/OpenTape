//! The recording preview: after you stop, a thumbnail of the recording waits in the bottom-left
//! corner, like Screen Studio's quick share, and follows you between displays. From it you can
//! save the recording to Downloads, copy it, open it in the editor, or close it.
//!
//! One step shows at a time: the record bar, then the preview, then the editor. The bar steps
//! aside while the preview shows and comes back when it closes.

use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, PoisonError},
    thread,
    time::Duration,
};

use objc2_app_kit::NSPopUpMenuWindowLevel;
use objc2_foundation::{NSPoint, NSSize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::alert::{self, Alert, Choice};
use crate::bar;
use crate::export;
use crate::follow::{self, Anchor};
use crate::keys::{self, Key};
use crate::macos_window;
use crate::pasteboard;
use crate::picker::Point;
use crate::recording::{self, CurrentRecording};

pub const LABEL: &str = "preview";
const POINTER_CHECK_EVERY: Duration = Duration::from_millis(33);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Shown {
    video_path: String,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    macos_window::with_ns_window(&window, |ns_window| {
        macos_window::float_panel(ns_window, NSPopUpMenuWindowLevel);
    })?;
    report_pointer(window);
    Ok(())
}

pub fn show(app: &AppHandle, video_path: &str) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let shown = Shown {
        video_path: video_path.to_string(),
    };
    bar::hide(app);
    let _ = app.emit_to(LABEL, "preview-show", shown);
    let _ = macos_window::with_ns_window(&window, |ns_window| {
        follow::place_on_pointer_screen(ns_window, Anchor::BottomLeft);
        ns_window.orderFrontRegardless();
    });
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// E, ⌘C and ⌘S while the pointer is over the preview. The page runs them, as if clicked.
pub fn on_key(app: &AppHandle, key: Key) {
    let action = match key {
        Key::Edit => "edit",
        Key::Copy => "copy",
        Key::Save => "save",
        Key::Escape | Key::Enter | Key::Tab => return,
    };
    let _ = app.emit_to(LABEL, "preview-key", action);
}

/// Saves the recording to Downloads as an `.mp4` named `name`, and returns where.
#[tauri::command]
pub async fn save_recording(app: AppHandle, name: String) -> Result<String, String> {
    save(&app, &name)
        .await
        .map(|path| path.display().to_string())
}

/// Puts the recording on the clipboard as an `.mp4` named `name`.
#[tauri::command]
pub async fn copy_recording(app: AppHandle, name: String) -> Result<(), String> {
    let video = current_video(&app)?;
    let copies = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("copies");
    let output = copies.join(export::file_name(&name));
    let exported = output.clone();
    recording::run_blocking(move || {
        std::fs::create_dir_all(&copies)?;
        export::to_mp4(&video, &exported)
    })
    .await?;
    app.run_on_main_thread(move || pasteboard::copy_file(&output))
        .map_err(|err| err.to_string())
}

/// Opens Finder with the saved `.mp4` selected.
#[tauri::command]
pub fn show_saved_in_finder(current: State<'_, CurrentRecording>) -> Result<(), String> {
    let saved_to = current.saved_to().ok_or("the recording isn't saved")?;
    Command::new("/usr/bin/open")
        .arg("-R")
        .arg(saved_to)
        .status()
        .map_err(|err| format!("could not open Finder: {err}"))?;
    Ok(())
}

/// The ×: closes the preview, asking first to save or delete an unsaved recording.
#[tauri::command]
pub async fn close_preview(app: AppHandle, name: String) -> Result<(), String> {
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
        .await
        .map_err(|err| err.to_string())?;
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
    current.discard()
}

async fn save(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let current = app.state::<CurrentRecording>();
    if let Some(saved_to) = current.saved_to() {
        return Ok(saved_to);
    }
    let video = current_video(app)?;
    let downloads = app.path().download_dir().map_err(|err| err.to_string())?;
    let output = export::free_path(&downloads, name, Path::exists);
    let exported = output.clone();
    recording::run_blocking(move || export::to_mp4(&video, &exported)).await?;
    current.mark_saved(output.clone());
    Ok(output)
}

fn current_video(app: &AppHandle) -> Result<PathBuf, String> {
    app.state::<CurrentRecording>()
        .video_path()
        .ok_or_else(|| "there's no recording".to_string())
}

/// Where the pointer is over the preview, or `None` when it's elsewhere. A page in an inactive
/// macOS window gets no mouse moves, so Rust tells it instead, only when the spot changes.
///
/// The preview's keys are taken while the pointer is over it, and given back when it leaves.
fn report_pointer(window: WebviewWindow) {
    let last = Arc::new(Mutex::new(None::<Point>));
    let mut has_keys = false;
    thread::spawn(move || {
        loop {
            let latest = Arc::clone(&last);
            let target = window.clone();
            let checked = macos_window::with_ns_window(&window, move |ns_window| {
                let pointer = ns_window
                    .isVisible()
                    .then(|| {
                        page_point(
                            ns_window.mouseLocationOutsideOfEventStream(),
                            ns_window.frame().size,
                        )
                    })
                    .flatten();
                let mut latest = latest.lock().unwrap_or_else(PoisonError::into_inner);
                if *latest != pointer {
                    *latest = pointer;
                    let _ = target.emit_to(LABEL, "preview-pointer", pointer);
                }
            });
            if checked.is_err() {
                return;
            }
            thread::sleep(POINTER_CHECK_EVERY);
            let is_over = last
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_some();
            if is_over != has_keys {
                let app = window.app_handle();
                let _ = if is_over {
                    keys::capture(app, keys::PREVIEW)
                } else {
                    keys::release(app, keys::PREVIEW)
                };
                has_keys = is_over;
            }
        }
    });
}

/// A spot in the window (bottom-left origin) as a spot on the page (top-left origin), if it's
/// inside the window.
fn page_point(pointer: NSPoint, size: NSSize) -> Option<Point> {
    let is_inside =
        (0.0..size.width).contains(&pointer.x) && (0.0..size.height).contains(&pointer.y);
    is_inside.then_some(Point {
        x: pointer.x,
        y: size.height - pointer.y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_point_should_measure_from_the_top_left() {
        let size = NSSize::new(360.0, 225.0);
        let point = page_point(NSPoint::new(20.0, 200.0), size);
        assert_eq!(point, Some(Point { x: 20.0, y: 25.0 }));
        assert_eq!(page_point(NSPoint::new(400.0, 10.0), size), None);
    }
}
