//! Keeps the floating windows (the record bar and the recording preview) on the display you're
//! working on: while one shows, its pointer loop sees each click, and a click on another
//! display moves it to its corner of that display.

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};

use crate::geometry::{self, Frame, Point};
/// Space between a floating window and the edge of the screen's usable area, in points.
const EDGE_GAP: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Anchor {
    BottomCenter,
    BottomLeft,
}

/// A screen's top-left corner in global points, measured like ScreenCaptureKit's displays, and
/// how far down from its top things stay clear of the menu bar and the notch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SafeTop {
    pub x: f64,
    pub y: f64,
    pub inset: f64,
}

pub(crate) fn safe_tops(main_thread: MainThreadMarker) -> Vec<SafeTop> {
    let screens = NSScreen::screens(main_thread);
    let Some(primary) = screens.firstObject() else {
        return Vec::new();
    };
    let primary_height = primary.frame().size.height;
    screens
        .iter()
        .map(|screen| {
            let frame = screen.frame();
            let visible = screen.visibleFrame();
            let menu_bar = top_of(frame) - top_of(visible);
            SafeTop {
                x: frame.origin.x,
                // NSScreen measures from the bottom-left of the primary screen.
                y: geometry::flip(frame, primary_height).origin.y,
                inset: menu_bar.max(screen.safeAreaInsets().top),
            }
        })
        .collect()
}

fn top_of(rect: NSRect) -> f64 {
    rect.origin.y + rect.size.height
}

pub(crate) fn place_on_primary_screen(
    ns_window: &NSWindow,
    main_thread: MainThreadMarker,
    anchor: Anchor,
) {
    if let Some(primary) = NSScreen::screens(main_thread).firstObject() {
        place(ns_window, &primary, anchor);
    }
}

pub(crate) fn place_on_pointer_screen(ns_window: &NSWindow, anchor: Anchor) {
    if let Some(screen) = screen_under_pointer(ns_window.mtm()) {
        place(ns_window, &screen, anchor);
    }
}

/// Moves the window to the display under the pointer. A window already there stays put, so a
/// dragged bar keeps its spot.
pub(crate) fn follow(ns_window: &NSWindow, anchor: Anchor) {
    let Some(screen) = screen_under_pointer(ns_window.mtm()) else {
        return;
    };
    let current = ns_window.screen().map(|current| current.frame());
    if current != Some(screen.frame()) {
        place(ns_window, &screen, anchor);
    }
}

fn screen_under_pointer(main_thread: MainThreadMarker) -> Option<Retained<NSScreen>> {
    let pointer = NSEvent::mouseLocation();
    NSScreen::screens(main_thread)
        .into_iter()
        .find(|screen| Frame::from(screen.frame()).contains(Point::from(pointer)))
}

fn place(ns_window: &NSWindow, screen: &NSScreen, anchor: Anchor) {
    ns_window.setFrameOrigin(origin(
        anchor,
        screen.visibleFrame(),
        ns_window.frame().size,
    ));
}

/// macOS measures from the bottom-left, so the top of the visible area is its highest y.
fn origin(anchor: Anchor, visible: NSRect, window: NSSize) -> NSPoint {
    match anchor {
        Anchor::BottomCenter => NSPoint::new(
            (visible.origin.x + (visible.size.width - window.width) / 2.0).round(),
            visible.origin.y + EDGE_GAP,
        ),
        Anchor::BottomLeft => {
            NSPoint::new(visible.origin.x + EDGE_GAP, visible.origin.y + EDGE_GAP)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP_VISIBLE: NSRect = NSRect::new(NSPoint::new(0.0, 80.0), NSSize::new(1512.0, 869.0));

    #[test]
    fn bottom_center_should_sit_centered_just_above_the_dock() {
        let origin = origin(
            Anchor::BottomCenter,
            LAPTOP_VISIBLE,
            NSSize::new(1000.0, 58.0),
        );
        assert_eq!((origin.x, origin.y), (256.0, 80.0 + EDGE_GAP));
    }

    #[test]
    fn bottom_left_should_sit_just_above_the_dock() {
        let origin = origin(
            Anchor::BottomLeft,
            LAPTOP_VISIBLE,
            NSSize::new(240.0, 176.0),
        );
        assert_eq!((origin.x, origin.y), (EDGE_GAP, 80.0 + EDGE_GAP));
    }
}
