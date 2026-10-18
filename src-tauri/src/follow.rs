//! Keeps the floating windows (the record bar and the recording preview) on the display you're
//! working on: a click on another display moves each one to its corner of that display.

use std::{thread, time::Duration};

use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{AppHandle, Manager};

use crate::{bar, macos_window, preview};

const CLICK_CHECK_EVERY: Duration = Duration::from_millis(33);
const LEFT_BUTTON: usize = 1;
/// Space between a floating window and the edge of the screen's usable area, in points.
const EDGE_GAP: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    BottomCenter,
    BottomLeft,
}

const FLOATING: [(&str, Anchor); 2] = [
    (bar::LABEL, Anchor::BottomCenter),
    (preview::LABEL, Anchor::BottomLeft),
];

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut was_down = false;
        loop {
            let is_down = NSEvent::pressedMouseButtons() & LEFT_BUTTON != 0;
            if is_down && !was_down {
                follow_click(&app);
            }
            was_down = is_down;
            thread::sleep(CLICK_CHECK_EVERY);
        }
    });
}

/// A screen's top-left corner in global points, measured like ScreenCaptureKit's displays, and
/// how far down from its top things stay clear of the menu bar and the notch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SafeTop {
    pub x: f64,
    pub y: f64,
    pub inset: f64,
}

pub fn safe_tops(main_thread: MainThreadMarker) -> Vec<SafeTop> {
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
                y: primary_height - top_of(frame),
                inset: menu_bar.max(screen.safeAreaInsets().top),
            }
        })
        .collect()
}

fn top_of(rect: NSRect) -> f64 {
    rect.origin.y + rect.size.height
}

pub fn place_on_primary_screen(
    ns_window: &NSWindow,
    main_thread: MainThreadMarker,
    anchor: Anchor,
) {
    if let Some(primary) = NSScreen::screens(main_thread).firstObject() {
        place(ns_window, &primary, anchor);
    }
}

pub fn place_on_pointer_screen(ns_window: &NSWindow, anchor: Anchor) {
    if let Some(screen) = screen_under_pointer() {
        place(ns_window, &screen, anchor);
    }
}

fn follow_click(app: &AppHandle) {
    for (label, anchor) in FLOATING {
        if let Some(window) = app.get_webview_window(label) {
            let _ = macos_window::with_ns_window(&window, move |ns_window| {
                follow(ns_window, anchor);
            });
        }
    }
}

/// A window already on the clicked display stays put, so a dragged bar keeps its spot.
fn follow(ns_window: &NSWindow, anchor: Anchor) {
    let Some(screen) = screen_under_pointer() else {
        return;
    };
    let current = ns_window.screen().map(|current| current.frame());
    if current != Some(screen.frame()) {
        place(ns_window, &screen, anchor);
    }
}

fn screen_under_pointer() -> Option<Retained<NSScreen>> {
    let main_thread = MainThreadMarker::new()?;
    let pointer = NSEvent::mouseLocation();
    NSScreen::screens(main_thread)
        .into_iter()
        .find(|screen| contains(screen.frame(), pointer))
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

fn contains(rect: NSRect, point: NSPoint) -> bool {
    point.x >= rect.origin.x
        && point.x < rect.origin.x + rect.size.width
        && point.y >= rect.origin.y
        && point.y < rect.origin.y + rect.size.height
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

    #[test]
    fn contains_should_find_the_screen_under_the_pointer() {
        let monitor = NSRect::new(NSPoint::new(1512.0, 0.0), NSSize::new(1920.0, 1080.0));
        assert!(contains(monitor, NSPoint::new(2000.0, 500.0)));
        assert!(!contains(LAPTOP_VISIBLE, NSPoint::new(2000.0, 500.0)));
    }
}
