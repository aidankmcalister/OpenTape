//! The picker overlay: one see-through window over each display, shown after a mode is
//! chosen on the record bar. Rust opens and closes the windows and reports where the cursor
//! is. The overlay page draws the highlight or the Area box.

use std::{
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::Result;
use cidre::cg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::capture::Target;
use crate::keys;
use crate::macos_window::{self, Level};
use crate::sources::{self, DisplayInfo, Sources};

const LABEL_PREFIX: &str = "picker-";
/// About 60 updates a second, enough for the highlight to feel attached to the cursor.
const CURSOR_EVERY: Duration = Duration::from_millis(16);
/// About 4 window-list checks a second; rebuilding the sources only happens when it changed.
const WINDOWS_EVERY_TICKS: u32 = 15;
/// Two positions this close are the same point (logical and physical units round differently).
const SAME_SPOT: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Display,
    Window,
    Area,
}

/// The cursor in global points, top-left origin, like the window and display frames.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Everything an overlay needs to draw its first frame.
#[derive(Debug, Clone, Serialize)]
pub struct Setup {
    pub mode: Mode,
    pub sources: Sources,
    pub cursor: Option<Point>,
}

#[derive(Default)]
pub struct PickerState {
    current: Mutex<Option<(Mode, Sources)>>,
    /// Bumped on every open and close, so an old cursor thread knows to stop.
    generation: Arc<AtomicU64>,
}

#[tauri::command]
pub async fn open_picker(
    app: AppHandle,
    state: State<'_, PickerState>,
    mode: Mode,
) -> Result<(), String> {
    let sources = tauri::async_runtime::spawn_blocking(sources::list)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| format!("{err:#}"))?;
    open(&app, &state, mode, sources).map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub fn picker_setup(state: State<'_, PickerState>) -> Result<Setup, String> {
    let current = state.current.lock().unwrap_or_else(PoisonError::into_inner);
    let (mode, sources) = current.clone().ok_or("the picker isn't open")?;
    Ok(Setup {
        mode,
        sources,
        cursor: cursor(),
    })
}

#[tauri::command]
pub fn close_picker(app: AppHandle, state: State<'_, PickerState>) -> Result<(), String> {
    close(&app, &state).map_err(|err| format!("{err:#}"))
}

/// Closes the overlays first, so they're gone before the record bar starts recording.
#[tauri::command]
pub fn pick(app: AppHandle, state: State<'_, PickerState>, target: Target) -> Result<(), String> {
    close(&app, &state).map_err(|err| format!("{err:#}"))?;
    app.emit("picked", target).map_err(|err| err.to_string())
}

/// Shows an overlay on every display, or switches the mode if they're already showing.
fn open(app: &AppHandle, state: &PickerState, mode: Mode, sources: Sources) -> Result<()> {
    let already_open = !overlays(app).is_empty();
    let displays = sources.displays.clone();
    *state.current.lock().unwrap_or_else(PoisonError::into_inner) = Some((mode, sources));
    if already_open {
        app.emit("picker-changed", mode)?;
        return Ok(());
    }
    for display in &displays {
        open_overlay(app, display)?;
    }
    follow_screen(app.clone(), &state.generation);
    if let Err(err) = keys::capture(app) {
        eprintln!("picker keys unavailable, use the bar instead: {err}");
    }
    Ok(())
}

pub fn close(app: &AppHandle, state: &PickerState) -> Result<()> {
    let _ = keys::release(app);
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.current.lock().unwrap_or_else(PoisonError::into_inner) = None;
    for overlay in overlays(app) {
        overlay.close()?;
    }
    app.emit("picker-closed", ())?;
    Ok(())
}

fn overlays(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, window)| window)
        .collect()
}

fn open_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let frame = display.frame;
    let label = format!("{LABEL_PREFIX}{}", display.id);
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Picker")
        .position(frame.x, frame.y)
        .inner_size(frame.width, frame.height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        // The first click on an overlay should press its button, not just focus the window.
        .accept_first_mouse(true)
        .focused(false)
        .build()?;
    macos_window::float_everywhere(&window, Level::Overlay)?;
    Ok(())
}

/// Until the picker closes or reopens: sends `picker-cursor` whenever the cursor moves, and
/// refreshes the sources whenever the window list changes, such as after switching spaces.
///
/// The overlays aren't focused, and a web page in an unfocused macOS window doesn't
/// get hover events, so Rust reports the cursor instead.
fn follow_screen(app: AppHandle, generation: &Arc<AtomicU64>) {
    let generation = Arc::clone(generation);
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        let mut last_cursor: Option<Point> = None;
        let mut last_windows = sources::stacking_order();
        let mut tick: u32 = 0;
        while generation.load(Ordering::SeqCst) == mine {
            if let Some(point) = cursor().filter(|point| !is_same_spot(last_cursor, *point)) {
                last_cursor = Some(point);
                let _ = app.emit("picker-cursor", point);
            }
            tick = tick.wrapping_add(1);
            if tick.is_multiple_of(WINDOWS_EVERY_TICKS) {
                let windows = sources::stacking_order();
                if windows != last_windows {
                    last_windows = windows;
                    refresh_sources(&app);
                }
            }
            thread::sleep(CURSOR_EVERY);
        }
    });
}

fn refresh_sources(app: &AppHandle) {
    let Ok(sources) = sources::list() else { return };
    let state = app.state::<PickerState>();
    let mode = {
        let mut current = state.current.lock().unwrap_or_else(PoisonError::into_inner);
        let Some((mode, old)) = current.as_mut() else {
            return;
        };
        *old = sources;
        *mode
    };
    let _ = app.emit("picker-changed", mode);
}

/// Reading the cursor this way needs no permission.
fn cursor() -> Option<Point> {
    let location = cg::Event::with_src(None)?.location();
    Some(Point {
        x: location.x,
        y: location.y,
    })
}

fn is_same_spot(last: Option<Point>, point: Point) -> bool {
    last.is_some_and(|last| {
        (last.x - point.x).abs() < SAME_SPOT && (last.y - point.y).abs() < SAME_SPOT
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_same_spot_should_ignore_sub_point_jitter() {
        let last = Some(Point { x: 10.0, y: 10.0 });
        assert!(is_same_spot(last, Point { x: 10.4, y: 9.8 }));
        assert!(!is_same_spot(last, Point { x: 12.0, y: 10.0 }));
        assert!(!is_same_spot(None, Point { x: 10.0, y: 10.0 }));
    }
}
