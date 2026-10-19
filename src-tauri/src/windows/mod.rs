//! The app's fixed windows: the record bar, the recording preview and the editor. They're
//! hidden instead of closed, so they can come back. The bar and the preview float (`floating`).

pub(crate) mod bar;
pub(crate) mod editor;
mod floating;
pub(crate) mod preview;

use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use tauri::{WebviewWindow, WindowEvent};

use crate::geometry;

/// Keeps a panel from ever closing: closing one crashes the app. ⌘W and `close()` both ask
/// first, so refusing here covers both; the app hides panels instead.
pub(crate) fn never_close(window: &WebviewWindow) {
    window.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
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
    let mut tops = Vec::new();
    for screen in screens.iter() {
        let frame = screen.frame();
        let visible = screen.visibleFrame();
        let menu_bar =
            (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
        tops.push(SafeTop {
            x: frame.origin.x,
            // NSScreen measures from the bottom-left of the primary screen.
            y: geometry::flip(frame, primary_height).origin.y,
            inset: menu_bar.max(screen.safeAreaInsets().top),
        });
    }
    tops
}
