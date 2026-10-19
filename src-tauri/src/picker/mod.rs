//! The picker: one see-through overlay window per display, shown after a mode is chosen on the
//! record bar. Rust owns the picker session (mode, sources, a window pinned with Tab, the
//! display holding the Area box) and sends it whole whenever it changes. Overlays only draw it.
//! While the picker is open, Rust also watches the cursor and the window list for them.

mod overlays;
mod sources;

use std::{collections::HashMap, sync::Mutex, time::Duration};

use anyhow::{Context, Result};
use cidre::cg;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Shortcut};
use ts_rs::TS;

use self::overlays::{is_overlay, overlay_label, overlays, place_glass, put_away, show_overlay};
pub(crate) use self::sources::Session;
use self::sources::{Mode, Setup, apply_safe_tops, framing};
use crate::capture::Target;
use crate::geometry::{Frame, Point};
use crate::util::{CmdResult, Poller, lock, run_blocking};
use crate::windows::{bar, safe_tops};
use crate::{KeySet, PageEvent, macos, recording};

#[derive(Default)]
pub(crate) struct PickerState(Mutex<Option<Session>>);

/// Runs only while the picker is open.
static SCREEN_LOOP: Poller = Poller::new();

/// Shows an overlay on every display, or switches the mode if they're already showing.
#[tauri::command]
pub(crate) async fn open_picker(
    app: AppHandle,
    state: State<'_, PickerState>,
    mode: Mode,
) -> CmdResult {
    let mut sources = run_blocking(|| sources::list(&HashMap::new())).await?;
    let safe_tops = macos::run_on_main_thread(&app, safe_tops)?;
    apply_safe_tops(&mut sources.displays, &safe_tops);
    let displays = sources.displays.clone();
    let session = Session::new(mode, sources, cursor_position());
    // Checked and replaced under one lock, so two quick opens can't both show the overlays.
    let already_open = lock(&state.0).replace(session).is_some();
    if already_open {
        announce_session(&app);
        return Ok(());
    }
    for display in &displays {
        show_overlay(&app, display)?;
    }
    watch_screen(app.clone());
    if let Err(err) = PickerKey::take(&app) {
        eprintln!("could not take the picker keys, so only the bar works: {err}");
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn picker_setup(state: State<'_, PickerState>) -> CmdResult<Setup> {
    let session = lock(&state.0).clone().context("the picker isn't open")?;
    Ok(Setup {
        session,
        cursor: cursor_position(),
    })
}

#[tauri::command]
pub(crate) fn close_picker(app: AppHandle) -> CmdResult {
    close(&app, None)?;
    Ok(())
}

/// The picker's last step: closes the overlays and starts recording `target`. For an area or a
/// window, the overlay on its display stays as the frame: still dimming everything else, but
/// click-through and without controls, until the recording ends.
#[tauri::command]
pub(crate) fn record(app: AppHandle, state: State<'_, PickerState>, target: Target) -> CmdResult {
    let Some(framing) = lock(&state.0)
        .as_ref()
        .map(|session| framing(session, &target))
    else {
        // A second click on Record: the first already closed the picker, kept the frame and
        // started recording. Closing again here would take that frame down.
        return Ok(());
    };
    let frame_overlay = framing
        .as_ref()
        .and_then(|framing| app.get_webview_window(&overlay_label(framing.display_id)));
    close(&app, frame_overlay.as_ref().map(|overlay| overlay.label()))?;
    if let (Some(overlay), Some(framing)) = (frame_overlay, framing) {
        // The frame is click-through, and shows only where the recording is.
        let framed = overlay.set_ignore_cursor_events(true).and_then(|()| {
            PageEvent::PickerRecording(framing.window).send_to(&app, overlay.label())
        });
        // Better no frame than one that blocks clicks on the whole display.
        if framed.is_err() {
            put_away(&overlay);
        }
    }
    recording::start(app, target);
    Ok(())
}

/// Takes down a recording's frame once the recording ends.
pub(crate) fn close_frame(app: &AppHandle) {
    for overlay in overlays(app) {
        put_away(&overlay);
    }
}

#[tauri::command]
pub(crate) fn pin_window(app: AppHandle, window_id: u32) {
    update_session(&app, |session| session.pinned_window_id = Some(window_id));
}

#[tauri::command]
pub(crate) fn move_area(app: AppHandle, display_id: u32) {
    update_session(&app, |session| session.area_display_id = Some(display_id));
}

#[tauri::command]
pub(crate) fn place_overlay_glass(window: WebviewWindow, rect: Option<Frame>) -> CmdResult {
    place_glass(&window, rect)?;
    Ok(())
}

/// Esc, Return and Tab, taken while the picker is open. The overlays hear Return and Tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PickerKey {
    /// Rust closes the picker itself, so the overlays never hear it.
    #[ts(skip)]
    Escape,
    Enter,
    Tab,
}

impl KeySet for PickerKey {
    const KEYS: [Self; 3] = [Self::Escape, Self::Enter, Self::Tab];

    fn shortcut(self) -> Shortcut {
        let code = match self {
            Self::Escape => Code::Escape,
            Self::Enter => Code::Enter,
            Self::Tab => Code::Tab,
        };
        Shortcut::new(None, code)
    }

    /// Esc closes the picker. Return and Tab go to every overlay, and each overlay decides from
    /// the session and the cursor it already has whether it's the one to act: the one holding
    /// the Area box, or else the one under the cursor. So the overlays' rule is the only one.
    fn press(self, app: &AppHandle) {
        if self == Self::Escape {
            // A key has nowhere to show an error. The overlays are put away even when this fails.
            if let Err(err) = close(app, None) {
                eprintln!("{err:#}");
            }
            return;
        }
        // A recording's frame is an overlay too, and must not hear keys once the picker is closed.
        if lock(&app.state::<PickerState>().0).is_none() {
            return;
        }
        // Fails only once the overlays are gone, and then no one is there to press it.
        let _ = PageEvent::PickerKey(self).send_to_each(app, is_overlay);
    }
}

/// Closes the picker, putting away every overlay but `keep`, the recording's frame.
fn close(app: &AppHandle, keep: Option<&str>) -> Result<()> {
    // Fails when the keys weren't taken, as when taking them failed. Nothing to give back then.
    let _ = PickerKey::give_back(app);
    SCREEN_LOOP.stop();
    *lock(&app.state::<PickerState>().0) = None;
    for overlay in overlays(app) {
        if Some(overlay.label()) != keep {
            put_away(&overlay);
        }
    }
    PageEvent::PickerClosed.send_to(app, bar::LABEL)?;
    Ok(())
}

fn update_session(app: &AppHandle, change: impl FnOnce(&mut Session)) {
    if let Some(session) = lock(&app.state::<PickerState>().0).as_mut() {
        change(session);
    }
    announce_session(app);
}

fn announce_session(app: &AppHandle) {
    let session = lock(&app.state::<PickerState>().0).clone();
    if let Some(session) = session {
        // Fails only once the overlays are gone, when no one is left to draw it.
        let _ = PageEvent::PickerSession(session).send_to_each(app, is_overlay);
    }
}

/// Reading the cursor this way needs no permission.
fn cursor_position() -> Option<Point> {
    let location = cg::Event::with_src(None)?.location();
    Some(Point {
        x: location.x,
        y: location.y,
    })
}

/// Until the picker closes: sends `picker-cursor` whenever the cursor moves (which also unpins
/// a Tab-pinned window), and refreshes the sources when the window list changes, such as after
/// switching spaces.
///
/// The overlays aren't focused, and a web page in an unfocused macOS window doesn't
/// get hover events, so Rust reports the cursor instead.
fn watch_screen(app: AppHandle) {
    let mut last_cursor = None;
    let mut last_window_list = sources::stacking_order();
    let mut ticks: u32 = 0;
    // About 60 ticks a second, enough for the highlight to feel attached to the cursor.
    SCREEN_LOOP.start(Duration::from_millis(16), move || {
        if let Some(point) = cursor_position()
            && !is_same_spot(last_cursor, point)
        {
            last_cursor = Some(point);
            // Only the overlays draw the cursor, so the other windows aren't woken for it.
            // Fails only once the overlays are gone.
            let _ = PageEvent::PickerCursor(point).send_to_each(&app, is_overlay);
            let is_pinned = lock(&app.state::<PickerState>().0)
                .as_ref()
                .is_some_and(|session| session.pinned_window_id.is_some());
            if is_pinned {
                update_session(&app, |session| session.pinned_window_id = None);
            }
        }
        // About 4 window-list checks a second; the sources are only rebuilt when it changed.
        ticks = ticks.wrapping_add(1);
        if ticks.is_multiple_of(15) {
            let window_list = sources::stacking_order();
            if window_list != last_window_list {
                last_window_list = window_list;
                refresh_sources(&app);
            }
        }
        true
    });
}

/// Lists the sources again, reusing the icons already sent so only new apps draw theirs.
fn refresh_sources(app: &AppHandle) {
    let known_icons = lock(&app.state::<PickerState>().0)
        .as_ref()
        .map(|session| session.sources.icons.clone())
        .unwrap_or_default();
    // A failed refresh keeps the last list; the next change to the window list tries again.
    let Ok(mut sources) = sources::list(&known_icons) else {
        return;
    };
    update_session(app, |session| {
        // Screens don't change mid-pick, so their safe tops carry over.
        for display in &mut sources.displays {
            let known = session
                .sources
                .displays
                .iter()
                .find(|known| known.id == display.id);
            if let Some(known) = known {
                display.safe_top = known.safe_top;
            }
        }
        session.sources = sources;
    });
}

/// Cursor moves smaller than a point aren't worth redrawing the highlight for.
fn is_same_spot(last: Option<Point>, point: Point) -> bool {
    last.is_some_and(|last| (last.x - point.x).abs() < 1.0 && (last.y - point.y).abs() < 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_same_spot_should_ignore_moves_under_a_point() {
        let last = Some(Point { x: 10.0, y: 10.0 });
        let cases = [
            (10.4, 9.8, true),
            (9.1, 10.9, true),
            (11.0, 10.0, false),
            (10.0, 9.0, false),
            (12.0, 10.0, false),
        ];
        for (x, y, same) in cases {
            assert_eq!(is_same_spot(last, Point { x, y }), same, "({x}, {y})");
        }
        assert!(!is_same_spot(None, Point { x: 10.0, y: 10.0 }));
    }
}
