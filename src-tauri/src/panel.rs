//! Turns a Tauri window into a non-activating panel: the kind of window macOS lets float on
//! every space, including other apps' full-screen ones, while the app keeps its Dock icon.
//! Electron's `type: 'panel'` and tauri-nspanel do the same.

use objc2::{
    ClassType, MainThreadOnly, define_class, ffi,
    runtime::{AnyClass, AnyObject},
};
use objc2_app_kit::{NSPanel, NSResponder, NSWindow, NSWindowStyleMask};
use objc2_foundation::NSObject;

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

pub fn convert(ns_window: &NSWindow) {
    let window: *const NSWindow = ns_window;
    let panel_class: *const AnyClass = FloatingPanel::class();
    // SAFETY: the window is a live NSWindow on the main thread, and the new class is an
    // NSWindow subclass with no extra state. Tao's own class only adds a `focusable` flag that
    // is read through methods this class overrides, which is the same swap tauri-nspanel makes.
    unsafe { ffi::object_setClass(window.cast_mut().cast::<AnyObject>(), panel_class) };
    ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
}
