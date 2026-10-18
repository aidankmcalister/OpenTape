//! macOS window settings Tauri doesn't expose: which spaces a window shows on, how high it
//! floats, and click-through.

use std::panic::AssertUnwindSafe;

use objc2::exception;
use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowLevel};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

use crate::panel;

/// Above the menu bar, so the overlay can dim and frame the whole display.
pub fn float_overlay(window: &WebviewWindow) -> tauri::Result<()> {
    with_ns_window(window, |ns_window| {
        float_panel(ns_window, NSStatusWindowLevel)
    })
}

/// For windows that live as long as the app: as a panel, the window can also join other apps'
/// full-screen spaces. Closing a converted window crashes, so short-lived ones stay plain.
pub fn float_panel(ns_window: &NSWindow, level: NSWindowLevel) {
    panel::convert(ns_window);
    float(ns_window, level);
}

/// Shows the window on every space at `level`.
fn float(ns_window: &NSWindow, level: NSWindowLevel) {
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHidesOnDeactivate(false);
    ns_window.setLevel(level);
}

/// Widens the window around its bottom center when `width` doesn't fit. It never narrows: the
/// see-through sides let clicks pass instead, so the pill can animate without a resize.
pub fn widen_to(ns_window: &NSWindow, width: f64) {
    let frame = ns_window.frame();
    if width > frame.size.width {
        let size = NSSize::new(width, frame.size.height);
        ns_window.setFrame_display(keep_bottom_center(frame, size), true);
    }
}

/// Lets clicks through everywhere except the centered pill of `pill_width`.
pub fn pass_clicks_beside(ns_window: &NSWindow, pill_width: f64) {
    let pointer = ns_window.mouseLocationOutsideOfEventStream();
    let window_width = ns_window.frame().size.width;
    let is_over_pill = (pointer.x - window_width / 2.0).abs() <= pill_width / 2.0;
    if ns_window.ignoresMouseEvents() == is_over_pill {
        ns_window.setIgnoresMouseEvents(!is_over_pill);
    }
}

fn keep_bottom_center(frame: NSRect, size: NSSize) -> NSRect {
    NSRect::new(
        NSPoint::new(
            frame.origin.x + (frame.size.width - size.width) / 2.0,
            frame.origin.y,
        ),
        size,
    )
}

/// Runs `change` with the window's `NSWindow`, on the main thread as AppKit requires.
///
/// AppKit reports misuse by throwing Objective-C exceptions, which Rust can't unwind through,
/// so they're caught and logged here instead of aborting the app.
pub fn with_ns_window(
    window: &WebviewWindow,
    change: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri returns a valid, live NSWindow pointer for this window, and this
        // closure runs on the main thread, which is where AppKit allows NSWindow calls.
        let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
        if let Err(thrown) = exception::catch(AssertUnwindSafe(|| change(ns_window))) {
            eprintln!("macOS rejected a window change: {thrown:?}");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_bottom_center_should_resize_around_the_bottom_middle() {
        let frame = NSRect::new(NSPoint::new(100.0, 90.0), NSSize::new(600.0, 58.0));
        let resized = keep_bottom_center(frame, NSSize::new(800.0, 58.0));
        assert_eq!((resized.origin.x, resized.origin.y), (0.0, 90.0));
    }
}
