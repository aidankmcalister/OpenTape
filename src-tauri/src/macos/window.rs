//! macOS window settings Tauri doesn't expose: which spaces a window shows on, how high it
//! floats, and click-through.
//!
//! Long-lived windows become non-activating panels: the kind of window macOS lets float on
//! every space, including other apps' full-screen ones, while the app keeps its Dock icon.
//! Electron's `type: 'panel'` and tauri-nspanel do the same.

use objc2::{
    ClassType, MainThreadOnly, define_class, ffi,
    runtime::{AnyClass, AnyObject},
};
use objc2_app_kit::{
    NSPanel, NSResponder, NSWindow, NSWindowCollectionBehavior, NSWindowLevel, NSWindowStyleMask,
};
use objc2_foundation::{NSObject, NSSize};
use tauri::WebviewWindow;

use super::main_thread;
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
/// It doesn't wait for `change` to run. An Objective-C exception it throws is caught and logged:
/// nothing is waiting to hear about it, and the next change tries again.
pub(crate) fn with_ns_window(
    window: &WebviewWindow,
    change: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        // Fails only once the window is gone, and then there's nothing to change.
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri hands back this window's NSWindow, or null, which `as_ref` turns into
        // `None`. This closure runs on the main thread, where AppKit allows NSWindow calls and
        // where windows are destroyed, so the window outlives the borrow, which ends with it.
        let Some(ns_window) = (unsafe { pointer.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        if let Err(err) = main_thread::catch(|| change(ns_window)) {
            eprintln!("could not change the {} window: {err:#}", target.label());
        }
    })
}

define_class!(
    // SAFETY: NSPanel has no subclassing requirements, and this class adds no instance
    // variables and no `Drop`, so `convert_to_panel` can swap it onto an existing window.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ScreenRecorderPanel"]
    struct FloatingPanel;

    impl FloatingPanel {
        /// Borderless panels refuse keyboard focus by default, but the Area fields need it.
        // SAFETY: the signature matches `-[NSWindow canBecomeKeyWindow]`, which returns a BOOL.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

/// Swaps the window's class for `FloatingPanel` in place, making it a non-activating panel. A
/// window it can't swap safely stays a plain floating window.
fn convert_to_panel(ns_window: &NSWindow) {
    let panel_class: &AnyClass = FloatingPanel::class();
    let object: &AnyObject = ns_window.as_ref();
    // A class whose objects are bigger than this one would read past the end of its memory.
    if panel_class.instance_size() > object.class().instance_size() {
        eprintln!("the window can't become a panel, so it won't show over full-screen apps");
        return;
    }
    let window: *const AnyObject = object;
    // SAFETY: the window is a live NSWindow, used on the main thread (`NSWindow` is
    // main-thread-only). `FloatingPanel` is an NSWindow subclass that adds no state and was just
    // checked to fit in the window's memory. Tao's own window class only adds a `focusable` flag
    // read by its own methods, which the swap leaves behind; tauri-nspanel makes the same swap.
    unsafe { ffi::object_setClass(window.cast_mut(), panel_class) };
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floating_panel_should_fit_in_a_plain_window() {
        let panel = FloatingPanel::class().instance_size();
        assert!(panel <= NSWindow::class().instance_size());
    }
}
