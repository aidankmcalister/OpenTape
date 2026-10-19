//! Watches the screen while the picker is open: reports the cursor to the overlays, and
//! refreshes the sources when the window list changes.

use std::time::Duration;

use cidre::cg;
use tauri::{AppHandle, Emitter, Manager};

use super::{PickerState, overlays::is_overlay, sources, update_session};
use crate::geometry::Point;
use crate::util::Poller;

/// About 60 updates a second, enough for the highlight to feel attached to the cursor.
const CURSOR_EVERY: Duration = Duration::from_millis(16);
/// About 4 window-list checks a second; rebuilding the sources only happens when it changed.
const WINDOWS_EVERY_TICKS: u32 = 15;
/// Cursor moves smaller than a point aren't worth redrawing the highlight for.
const SAME_SPOT: f64 = 1.0;

/// Runs only while the picker is open.
static SCREEN_LOOP: Poller = Poller::new();

/// Until the picker closes: sends `picker-cursor` whenever the cursor moves (which also unpins
/// a Tab-pinned window), and refreshes the sources when the window list changes, such as after
/// switching spaces.
///
/// The overlays aren't focused, and a web page in an unfocused macOS window doesn't
/// get hover events, so Rust reports the cursor instead.
pub(super) fn follow_screen(app: AppHandle) {
    let mut last_cursor: Option<Point> = None;
    let mut last_windows = sources::stacking_order();
    let mut tick: u32 = 0;
    SCREEN_LOOP.start(CURSOR_EVERY, move || {
        if let Some(point) = cursor().filter(|point| !is_same_spot(last_cursor, *point)) {
            last_cursor = Some(point);
            // Only the overlays draw the cursor, so the other windows aren't woken for it. Fails
            // only once the overlays are gone.
            let _ = app.emit_filter("picker-cursor", point, is_overlay);
            unpin_window(&app);
        }
        tick = tick.wrapping_add(1);
        if tick.is_multiple_of(WINDOWS_EVERY_TICKS) {
            let windows = sources::stacking_order();
            if windows != last_windows {
                last_windows = windows;
                refresh_sources(&app);
            }
        }
        true
    });
}

pub(super) fn stop_following_screen() {
    SCREEN_LOOP.stop();
}

/// Lists the sources again, reusing the icons already sent so only new apps draw theirs.
fn refresh_sources(app: &AppHandle) {
    let known_icons = app
        .state::<PickerState>()
        .session()
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
            if let Some(known) = session.sources.displays.iter().find(|d| d.id == display.id) {
                display.safe_top = known.safe_top;
            }
        }
        session.sources = sources;
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
pub(super) fn cursor() -> Option<Point> {
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
