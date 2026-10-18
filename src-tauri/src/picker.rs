//! The picker: one see-through overlay window per display, shown after a mode is chosen on the
//! record bar. Rust owns the picker session (mode, sources, a window pinned with Tab, the
//! display holding the Area box) and sends it whole whenever it changes. Overlays only draw it.

use std::{
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::Result;
use cidre::cg;
use objc2::MainThreadMarker;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::capture::Target;
use crate::follow;
use crate::glass;
use crate::keys::{self, Key};
use crate::macos_window;
use crate::recording;
use crate::sources::{self, DisplayInfo, Frame, Sources};

const LABEL_PREFIX: &str = "picker-";
/// About 60 updates a second, enough for the highlight to feel attached to the cursor.
const CURSOR_EVERY: Duration = Duration::from_millis(16);
/// About 4 window-list checks a second; rebuilding the sources only happens when it changed.
const WINDOWS_EVERY_TICKS: u32 = 15;
/// Cursor moves smaller than a point aren't worth redrawing the highlight for.
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    mode: Mode,
    sources: Sources,
    /// A window chosen with Tab. It wins over the cursor until the cursor moves.
    pinned_window_id: Option<u32>,
    area_display_id: Option<u32>,
}

impl Session {
    /// The Area box starts on the display you're pointing at.
    fn new(mode: Mode, sources: Sources, cursor: Option<Point>) -> Self {
        let area_display_id = display_under(&sources.displays, cursor)
            .or_else(|| sources.displays.first().map(|display| display.id));
        Self {
            mode,
            sources,
            pinned_window_id: None,
            area_display_id,
        }
    }
}

/// Everything an overlay needs to draw its first frame.
#[derive(Debug, Clone, Serialize)]
pub struct Setup {
    session: Session,
    cursor: Option<Point>,
}

#[derive(Default)]
pub struct PickerState {
    session: Mutex<Option<Session>>,
    /// Bumped on every open and close, so an old cursor thread knows to stop.
    generation: Arc<AtomicU64>,
}

impl PickerState {
    fn session(&self) -> MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tauri::command]
pub async fn open_picker(
    app: AppHandle,
    state: State<'_, PickerState>,
    mode: Mode,
) -> Result<(), String> {
    let mut sources = recording::run_blocking(sources::list).await?;
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        if let Some(main_thread) = MainThreadMarker::new() {
            let _ = sender.send(follow::safe_tops(main_thread));
        }
    })
    .map_err(|err| err.to_string())?;
    apply_safe_tops(&mut sources.displays, &receiver.recv().unwrap_or_default());
    open(&app, &state, mode, sources).map_err(|err| format!("{err:#}"))
}

/// Gives each display the safe top of the screen at its corner.
fn apply_safe_tops(displays: &mut [DisplayInfo], tops: &[follow::SafeTop]) {
    for display in displays {
        display.safe_top = tops
            .iter()
            .find(|top| {
                (top.x - display.frame.x).abs() < 1.0 && (top.y - display.frame.y).abs() < 1.0
            })
            .map_or(0.0, |top| top.inset);
    }
}

#[tauri::command]
pub fn picker_setup(state: State<'_, PickerState>) -> Result<Setup, String> {
    let session = state.session().clone().ok_or("the picker isn't open")?;
    Ok(Setup {
        session,
        cursor: cursor(),
    })
}

#[tauri::command]
pub fn close_picker(app: AppHandle, state: State<'_, PickerState>) -> Result<(), String> {
    close(&app, &state).map_err(|err| format!("{err:#}"))
}

/// The picker's last step: closes the overlays and starts recording `target`. For an area or a
/// window, the overlay on its display stays as the frame: still dimming everything else, but
/// click-through and without controls, until the recording ends.
#[tauri::command]
pub fn record(app: AppHandle, state: State<'_, PickerState>, target: Target) -> Result<(), String> {
    let framing = state
        .session()
        .as_ref()
        .and_then(|session| framing(session, &target));
    let frame = framing
        .as_ref()
        .and_then(|framing| app.get_webview_window(&overlay_label(framing.display_id)));
    let keep = frame.as_ref().map(|frame| frame.label().to_string());
    close_except(&app, &state, keep.as_deref()).map_err(|err| format!("{err:#}"))?;
    if let (Some(frame), Some(framing)) = (frame, framing) {
        let _ = frame.set_ignore_cursor_events(true);
        let _ = frame.emit_to(frame.label(), "picker-recording", framing.window);
    }
    recording::start(app, target);
    Ok(())
}

/// Which overlay frames a recording, and for a window, where the window sits on that display.
#[derive(Debug, PartialEq)]
struct Framing {
    display_id: u32,
    window: Option<Frame>,
}

fn framing(session: &Session, target: &Target) -> Option<Framing> {
    match *target {
        Target::Area { display_id, .. } => Some(Framing {
            display_id,
            window: None,
        }),
        Target::Window { window_id } => {
            let window = session
                .sources
                .windows
                .iter()
                .find(|window| window.id == window_id)?;
            let frame = window.frame;
            let center = Point {
                x: frame.x + frame.width / 2.0,
                y: frame.y + frame.height / 2.0,
            };
            let display = session
                .sources
                .displays
                .iter()
                .find(|display| contains(display.frame, center))?;
            Some(Framing {
                display_id: display.id,
                window: Some(Frame {
                    x: frame.x - display.frame.x,
                    y: frame.y - display.frame.y,
                    ..frame
                }),
            })
        }
        Target::Display { .. } => None,
    }
}

/// Takes down a recording's frame once the recording ends.
pub fn close_frame(app: &AppHandle) {
    for overlay in overlays(app) {
        put_away(&overlay);
    }
}

#[tauri::command]
pub fn pin_window(app: AppHandle, window_id: u32) {
    update_session(&app, |session| session.pinned_window_id = Some(window_id));
}

#[tauri::command]
pub fn move_area(app: AppHandle, display_id: u32) {
    update_session(&app, |session| session.area_display_id = Some(display_id));
}

/// Esc closes the picker. Return and Tab go to the one overlay that should act on them: the
/// one holding the Area box, or else the one under the cursor.
pub fn on_key(app: &AppHandle, key: Key) {
    let state = app.state::<PickerState>();
    let name = match key {
        Key::Escape => {
            let _ = close(app, &state);
            return;
        }
        Key::Enter => "Enter",
        Key::Tab => "Tab",
        Key::Edit | Key::Copy | Key::Save => return,
    };
    let display_id = state
        .session()
        .as_ref()
        .and_then(|session| match session.mode {
            Mode::Area => session.area_display_id,
            Mode::Display | Mode::Window => display_under(&session.sources.displays, cursor()),
        });
    if let Some(display_id) = display_id {
        let _ = app.emit_to(overlay_label(display_id).as_str(), "picker-key", name);
    }
}

/// Shows an overlay on every display, or switches the mode if they're already showing.
fn open(app: &AppHandle, state: &PickerState, mode: Mode, sources: Sources) -> Result<()> {
    let already_open = state.session().is_some();
    let displays = sources.displays.clone();
    *state.session() = Some(Session::new(mode, sources, cursor()));
    if already_open {
        announce(app, state);
        return Ok(());
    }
    for display in &displays {
        show_overlay(app, display)?;
    }
    follow_screen(app.clone(), &state.generation);
    if let Err(err) = keys::capture(app, keys::PICKER) {
        eprintln!("picker keys unavailable, use the bar instead: {err}");
    }
    Ok(())
}

pub fn close(app: &AppHandle, state: &PickerState) -> Result<()> {
    close_except(app, state, None)
}

fn close_except(app: &AppHandle, state: &PickerState, keep: Option<&str>) -> Result<()> {
    let _ = keys::release(app, keys::PICKER);
    state.generation.fetch_add(1, Ordering::SeqCst);
    *state.session() = None;
    for overlay in overlays(app) {
        if Some(overlay.label()) != keep {
            put_away(&overlay);
        }
    }
    app.emit("picker-closed", ())?;
    Ok(())
}

fn update_session(app: &AppHandle, change: impl FnOnce(&mut Session)) {
    let state = app.state::<PickerState>();
    if let Some(session) = state.session().as_mut() {
        change(session);
    }
    announce(app, &state);
}

fn announce(app: &AppHandle, state: &PickerState) {
    let session = state.session().clone();
    if let Some(session) = session {
        let _ = app.emit("picker-session", session);
    }
}

fn overlays(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, window)| window)
        .collect()
}

fn overlay_label(display_id: u32) -> String {
    format!("{LABEL_PREFIX}{display_id}")
}

/// Overlays are panels, so they can show over another app's full-screen space. Closing a panel
/// crashes, so each display's overlay is made once, then hidden and shown again.
fn show_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let Some(window) = app.get_webview_window(&overlay_label(display.id)) else {
        return build_overlay(app, display);
    };
    let frame = display.frame;
    window.set_position(LogicalPosition::new(frame.x, frame.y))?;
    window.set_size(LogicalSize::new(frame.width, frame.height))?;
    window.set_ignore_cursor_events(false)?;
    macos_window::with_ns_window(&window, |ns_window| ns_window.orderFrontRegardless())?;
    Ok(())
}

/// Hides an overlay and reloads its page while it's out of sight, so it comes back fresh.
fn put_away(overlay: &WebviewWindow) {
    let _ = overlay.hide();
    let _ = place_glass(overlay, None);
    let _ = overlay.reload();
}

/// Puts the frosted glass under the overlay's capture bar, or hides it with `None`.
#[tauri::command]
pub fn place_overlay_glass(window: WebviewWindow, rect: Option<Frame>) -> Result<(), String> {
    place_glass(&window, rect).map_err(|err| err.to_string())
}

fn place_glass(overlay: &WebviewWindow, rect: Option<Frame>) -> tauri::Result<()> {
    let pill = rect.map(|rect| {
        NSRect::new(
            NSPoint::new(rect.x, rect.y),
            NSSize::new(rect.width, rect.height),
        )
    });
    macos_window::with_ns_window(overlay, move |ns_window| {
        if let Some(main_thread) = MainThreadMarker::new() {
            glass::place(ns_window, main_thread, pill);
        }
    })
}

fn build_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let frame = display.frame;
    let window = WebviewWindowBuilder::new(app, overlay_label(display.id), WebviewUrl::default())
        .position(frame.x, frame.y)
        .inner_size(frame.width, frame.height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        // The first click on an overlay should press its button, not just focus the window.
        .accept_first_mouse(true)
        .focused(false)
        .build()?;
    macos_window::float_overlay(&window)?;
    Ok(())
}

/// Until the picker closes or reopens: sends `picker-cursor` whenever the cursor moves (which
/// also unpins a Tab-pinned window), and refreshes the sources when the window list changes,
/// such as after switching spaces.
///
/// The overlays aren't focused, and a web page in an unfocused macOS window doesn't
/// get hover events, so Rust reports the cursor instead.
fn follow_screen(app: AppHandle, generation: &Arc<AtomicU64>) {
    let generation = Arc::clone(generation);
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
    // Only the overlays draw the cursor, so the other windows aren't woken 60 times a second.
    let labels: Vec<String> = overlays(&app)
        .iter()
        .map(|overlay| overlay.label().to_string())
        .collect();
    thread::spawn(move || {
        let mut last_cursor: Option<Point> = None;
        let mut last_windows = sources::stacking_order();
        let mut tick: u32 = 0;
        while generation.load(Ordering::SeqCst) == mine {
            if let Some(point) = cursor().filter(|point| !is_same_spot(last_cursor, *point)) {
                last_cursor = Some(point);
                for label in &labels {
                    let _ = app.emit_to(label.as_str(), "picker-cursor", point);
                }
                unpin_window(&app);
            }
            tick = tick.wrapping_add(1);
            if tick.is_multiple_of(WINDOWS_EVERY_TICKS) {
                let windows = sources::stacking_order();
                if windows != last_windows {
                    last_windows = windows;
                    if let Ok(mut sources) = sources::list() {
                        update_session(&app, |session| {
                            // Screens don't change mid-pick, so their safe tops carry over.
                            for display in &mut sources.displays {
                                if let Some(known) =
                                    session.sources.displays.iter().find(|d| d.id == display.id)
                                {
                                    display.safe_top = known.safe_top;
                                }
                            }
                            session.sources = sources;
                        });
                    }
                }
            }
            thread::sleep(CURSOR_EVERY);
        }
    });
}

fn unpin_window(app: &AppHandle) {
    let state = app.state::<PickerState>();
    let is_pinned = state
        .session()
        .as_ref()
        .is_some_and(|session| session.pinned_window_id.is_some());
    if is_pinned {
        update_session(app, |session| session.pinned_window_id = None);
    }
}

/// Reading the cursor this way needs no permission.
fn cursor() -> Option<Point> {
    let location = cg::Event::with_src(None)?.location();
    Some(Point {
        x: location.x,
        y: location.y,
    })
}

fn display_under(displays: &[DisplayInfo], point: Option<Point>) -> Option<u32> {
    let point = point?;
    displays
        .iter()
        .find(|display| contains(display.frame, point))
        .map(|display| display.id)
}

fn contains(frame: Frame, point: Point) -> bool {
    point.x >= frame.x
        && point.x < frame.x + frame.width
        && point.y >= frame.y
        && point.y < frame.y + frame.height
}

fn is_same_spot(last: Option<Point>, point: Point) -> bool {
    last.is_some_and(|last| {
        (last.x - point.x).abs() < SAME_SPOT && (last.y - point.y).abs() < SAME_SPOT
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CaptureSize;
    use crate::sources::WindowInfo;

    fn display(id: u32, x: f64) -> DisplayInfo {
        let frame = Frame {
            x,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        };
        DisplayInfo {
            id,
            name: format!("Display {id}"),
            frame,
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
            safe_top: 0.0,
        }
    }

    #[test]
    fn is_same_spot_should_ignore_sub_point_jitter() {
        let last = Some(Point { x: 10.0, y: 10.0 });
        assert!(is_same_spot(last, Point { x: 10.4, y: 9.8 }));
        assert!(!is_same_spot(last, Point { x: 12.0, y: 10.0 }));
        assert!(!is_same_spot(None, Point { x: 10.0, y: 10.0 }));
    }

    #[test]
    fn display_under_should_find_the_display_with_the_cursor() {
        let displays = [display(1, 0.0), display(2, 1000.0)];
        assert_eq!(
            display_under(&displays, Some(Point { x: 1500.0, y: 10.0 })),
            Some(2)
        );
        assert_eq!(display_under(&displays, None), None);
    }

    #[test]
    fn apply_safe_tops_should_match_screens_by_corner() {
        let mut displays = [display(1, 0.0), display(2, 1000.0)];
        let notched = follow::SafeTop {
            x: 0.0,
            y: 0.0,
            inset: 38.0,
        };
        apply_safe_tops(&mut displays, &[notched]);
        assert_eq!(displays[0].safe_top, 38.0);
        assert_eq!(displays[1].safe_top, 0.0);
    }

    #[test]
    fn framing_should_place_a_window_on_its_display() {
        let window = WindowInfo {
            id: 7,
            pid: 1,
            app: "Notes".into(),
            frame: Frame {
                x: 1100.0,
                y: 50.0,
                width: 400.0,
                height: 300.0,
            },
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
        };
        let sources = Sources {
            displays: vec![display(1, 0.0), display(2, 1000.0)],
            windows: vec![window],
            icons: Default::default(),
        };
        let session = Session::new(Mode::Window, sources, None);
        let framing = framing(&session, &Target::Window { window_id: 7 });
        let expected = Frame {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        };
        assert_eq!(
            framing,
            Some(Framing {
                display_id: 2,
                window: Some(expected),
            })
        );
    }

    #[test]
    fn session_should_start_the_area_box_under_the_cursor() {
        let sources = Sources {
            displays: vec![display(1, 0.0), display(2, 1000.0)],
            windows: Vec::new(),
            icons: Default::default(),
        };
        let session = Session::new(Mode::Area, sources, Some(Point { x: 1200.0, y: 5.0 }));
        assert_eq!(session.area_display_id, Some(2));
    }
}
