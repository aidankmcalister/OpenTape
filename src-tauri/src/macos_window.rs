//! macOS window settings Tauri doesn't expose: show on every desktop and over
//! full-screen apps, at a chosen height in the window stack.

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSPopUpMenuWindowLevel, NSStatusWindowLevel,
    NSWindow, NSWindowCollectionBehavior,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

/// How high a window floats. The bar must sit above the overlay so it stays clickable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Above the menu bar, so the overlay can dim and highlight the whole display.
    Overlay,
    /// Above the overlay.
    Bar,
}

/// Shows the window on every space at `level`. Fine for windows opened on the space they're used on.
pub fn float_everywhere(window: &WebviewWindow, level: Level) -> tauri::Result<()> {
    with_ns_window(window, move |ns_window| float(ns_window, level))
}

/// Like [`float_everywhere`], but also follows you onto other apps' full-screen spaces.
///
/// macOS only lets an accessory app's windows do that, so the app is one just while the window
/// is set up, then switches back to keep its Dock icon. Electron does the same.
pub fn float_over_full_screen_apps(window: &WebviewWindow, level: Level) -> tauri::Result<()> {
    with_ns_window(window, move |ns_window| {
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let app = NSApplication::sharedApplication(main_thread);
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        float(ns_window, level);
        ns_window.orderFrontRegardless();
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    })
}

fn float(ns_window: &NSWindow, level: Level) {
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHidesOnDeactivate(false);
    ns_window.setLevel(match level {
        Level::Overlay => NSStatusWindowLevel,
        Level::Bar => NSPopUpMenuWindowLevel,
    });
}

/// Widens the window around its top center when `width` doesn't fit. It never narrows: the
/// see-through sides let clicks pass instead, so the pill can animate without a resize.
pub fn widen_to(ns_window: &NSWindow, width: f64) {
    let frame = ns_window.frame();
    if width > frame.size.width {
        let size = NSSize::new(width, frame.size.height);
        ns_window.setFrame_display(keep_top_center(frame, size), true);
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

/// macOS measures windows from the bottom-left, so keeping the top means moving the origin.
fn keep_top_center(frame: NSRect, size: NSSize) -> NSRect {
    NSRect::new(
        NSPoint::new(
            frame.origin.x + (frame.size.width - size.width) / 2.0,
            frame.origin.y + frame.size.height - size.height,
        ),
        size,
    )
}

/// Runs `change` with the window's `NSWindow`, on the main thread as AppKit requires.
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
        change(ns_window);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_top_center_should_shrink_around_the_top_middle() {
        let frame = NSRect::new(NSPoint::new(100.0, 900.0), NSSize::new(600.0, 58.0));
        let resized = keep_top_center(frame, NSSize::new(200.0, 40.0));
        assert_eq!(resized.origin.x, 300.0);
        assert_eq!(resized.origin.y + resized.size.height, 958.0);
    }
}
