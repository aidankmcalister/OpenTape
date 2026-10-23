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
use crate::macos::{self, glass};
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

pub(super) fn is_overlay(target: &EventTarget) -> bool {
    match target {
        EventTarget::AnyLabel { label }
        | EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label } => label.starts_with(LABEL_PREFIX),
        _ => false,
    }
}

pub(super) fn show_overlay(app: &AppHandle, display: &DisplayInfo) -> Result<()> {
    let Some(window) = app.get_webview_window(&overlay_label(display.id)) else {
        return build_overlay(app, display, true);
    };
    let frame = display.frame;
    window.set_position(LogicalPosition::new(frame.x, frame.y))?;
    window.set_size(LogicalSize::new(frame.width, frame.height))?;
    window.set_ignore_cursor_events(false)?;
    macos::with_ns_window(&window, |ns_window| ns_window.orderFrontRegardless())?;
    Ok(())
}

pub(super) fn put_away(overlay: &WebviewWindow) {
    let _ = overlay.hide();
    let _ = place_glass(overlay, None);
    let _ = overlay.reload();
}

pub(super) fn place_glass(overlay: &WebviewWindow, rect: Option<Frame>) -> tauri::Result<()> {
    let pill = rect.map(NSRect::from);
    macos::with_ns_window(overlay, move |ns_window| {
        glass::place(ns_window, ns_window.mtm(), pill);
    })
}

pub(super) fn prepare_overlays(app: &AppHandle, displays: &[DisplayInfo]) -> Result<()> {
    for display in displays {
        if app.get_webview_window(&overlay_label(display.id)).is_none() {
            build_overlay(app, display, false)?;
        }
    }
    Ok(())
}

fn build_overlay(app: &AppHandle, display: &DisplayInfo, visible: bool) -> Result<()> {
    let frame = display.frame;
    let window = WebviewWindowBuilder::new(app, overlay_label(display.id), WebviewUrl::default())
        .position(frame.x, frame.y)
        .inner_size(frame.width, frame.height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .accept_first_mouse(true)
        .focused(false)
        .visible(visible)
        .build()?;
    windows::never_close(&window);
    macos::with_ns_window(&window, |ns_window| {
        macos::float_panel(ns_window, NSStatusWindowLevel);
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
