//! macOS window settings Tauri doesn't expose: which spaces a window shows on, how high it
//! floats, and click-through.
//!
//! Long-lived windows become non-activating panels: the kind of window macOS lets float on
//! every space, including other apps' full-screen ones, while the app keeps its Dock icon.
//! Electron's `type: 'panel'` and tauri-nspanel do the same.

use std::panic::AssertUnwindSafe;

use objc2::{
    ClassType, MainThreadOnly, define_class, exception, ffi,
    runtime::{AnyClass, AnyObject},
};
use objc2_app_kit::{
    NSPanel, NSResponder, NSWindow, NSWindowCollectionBehavior, NSWindowLevel, NSWindowStyleMask,
};
use objc2_foundation::{NSObject, NSSize};
use tauri::WebviewWindow;

use crate::geometry;

/// Shows the window on every space at `level`. For windows that live as long as the app: as a
/// panel, the window can also join other apps' full-screen spaces. Closing a converted window
/// crashes, so short-lived ones stay plain.
pub(crate) fn float_panel(ns_window: &NSWindow, level: NSWindowLevel) {
    convert_to_panel(ns_window);
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
pub(crate) fn widen_to(ns_window: &NSWindow, width: f64) {
    let frame = ns_window.frame();
    if width > frame.size.width {
        let size = NSSize::new(width, frame.size.height);
        ns_window.setFrame_display(geometry::keep_bottom_center(frame, size), true);
    }
}

/// Lets clicks through everywhere except the centered pill of `pill_width`.
pub(crate) fn pass_clicks_beside(ns_window: &NSWindow, pill_width: f64) {
    let pointer = ns_window.mouseLocationOutsideOfEventStream();
    let window_width = ns_window.frame().size.width;
    let is_over_pill = (pointer.x - window_width / 2.0).abs() <= pill_width / 2.0;
    if ns_window.ignoresMouseEvents() == is_over_pill {
        ns_window.setIgnoresMouseEvents(!is_over_pill);
    }
}

/// Runs `change` with the window's `NSWindow`, on the main thread as AppKit requires.
///
/// AppKit reports misuse by throwing Objective-C exceptions, which Rust can't unwind through,
/// so they're caught and logged here instead of aborting the app.
pub(crate) fn with_ns_window(
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

define_class!(
    // SAFETY: NSPanel has no subclassing requirements, and this class adds no instance
    // variables, so it fits in the memory of the window it replaces.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ScreenRecorderPanel"]
    struct FloatingPanel;

    impl FloatingPanel {
        /// Borderless panels refuse keyboard focus by default, but the Area fields need it.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

/// Swaps the window's class for `FloatingPanel` in place, making it a non-activating panel.
fn convert_to_panel(ns_window: &NSWindow) {
    let window: *const NSWindow = ns_window;
    let panel_class: *const AnyClass = FloatingPanel::class();
    // SAFETY: the window is a live NSWindow on the main thread, and the new class is an
    // NSWindow subclass with no extra state. Tao's own class only adds a `focusable` flag that
    // is read through methods this class overrides, which is the same swap tauri-nspanel makes.
    unsafe { ffi::object_setClass(window.cast_mut().cast::<AnyObject>(), panel_class) };
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
}
