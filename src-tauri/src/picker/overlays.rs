//! The picker's overlay windows: one see-through panel per display. They're made once, then
//! hidden and shown again, because closing a panel crashes.

use anyhow::Result;
use objc2::MainThreadOnly;
use objc2_app_kit::NSStatusWindowLevel;
use objc2_foundation::NSRect;
use tauri::{
    AppHandle, EventTarget, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use super::sources::DisplayInfo;
use crate::geometry::Frame;
use crate::macos::{glass, window as macos_window};
use crate::windows;

const LABEL_PREFIX: &str = "picker-";

pub(super) fn overlays(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, window)| window)
        .collect()
}

pub(super) fn overlay_label(display_id: u32) -> String {
    format!("{LABEL_PREFIX}{display_id}")
}

/// For `emit_filter`: sends an event to every overlay in one go. Emitting to each overlay by
/// label would also run a script in every other overlay listening for it.
pub(super) fn is_overlay(target: &EventTarget) -> bool {
    match target {
        EventTarget::AnyLabel { label }
        | EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label } => label.starts_with(LABEL_PREFIX),
        _ => false,
    }
}

/// Overlays are panels, so they can show over another app's full-screen space. Closing a panel
/// crashes, so each display's overlay is made once, then hidden and shown again.
pub(super) fn show_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let Some(window) = app.get_webview_window(&overlay_label(display.id)) else {
        return build_overlay(app, display);
    };
    let frame = display.frame;
    window.set_position(LogicalPosition::new(frame.x, frame.y))?;
    window.set_size(LogicalSize::new(frame.width, frame.height))?;
    window.set_ignore_cursor_events(false)?;
    macos_window::with_ns_window(&window, |ns_window| ns_window.orderFrontRegardless())?;
    Ok(())
}

/// Hides an overlay and reloads its page while it's out of sight, so it comes back fresh.
pub(super) fn put_away(overlay: &WebviewWindow) {
    // Each step fails only once the window is gone, and then there's nothing left to put away.
    let _ = overlay.hide();
    let _ = place_glass(overlay, None);
    let _ = overlay.reload();
}

/// Puts the frosted glass under the overlay's capture bar, or hides it with `None`.
pub(super) fn place_glass(overlay: &WebviewWindow, rect: Option<Frame>) -> tauri::Result<()> {
    let pill = rect.map(NSRect::from);
    macos_window::with_ns_window(overlay, move |ns_window| {
        glass::place(ns_window, ns_window.mtm(), pill);
    })
}

fn build_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let frame = display.frame;
    let window = WebviewWindowBuilder::new(app, overlay_label(display.id), WebviewUrl::default())
        .position(frame.x, frame.y)
        .inner_size(frame.width, frame.height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        // The first click on an overlay should press its button, not just focus the window.
        .accept_first_mouse(true)
        .focused(false)
        .build()?;
    windows::never_close(&window);
    // Above the menu bar, so the overlay can dim and frame the whole display.
    macos_window::with_ns_window(&window, |ns_window| {
        macos_window::float_panel(ns_window, NSStatusWindowLevel);
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_overlay_should_match_only_overlay_labels() {
        assert!(is_overlay(&EventTarget::labeled(overlay_label(1))));
        assert!(is_overlay(&EventTarget::webview_window(overlay_label(2))));
        assert!(!is_overlay(&EventTarget::labeled("bar")));
        assert!(!is_overlay(&EventTarget::Any));
    }
}
