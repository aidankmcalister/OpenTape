use objc2_foundation::{NSRect, NSSize};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use ts_rs::TS;

use super::floating::{Anchor, Behavior, Floating, Hover};
use crate::util::CmdResult;
use crate::{KeySet, PageEvent, macos};

pub(crate) const LABEL: &str = "preview";
const AREA: f64 = 360.0 * 225.0;

pub(crate) static WINDOW: Floating = Floating::new(Behavior {
    label: LABEL,
    anchor: Anchor::BottomLeft,
    keeps_its_spot: false,
    on_pointer: |_| {},
    hover: Some(Hover {
        event: PageEvent::PreviewPointer,
        on_enter_or_leave: hold_keys,
    }),
});

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview_window(LABEL) {
        Some(window) => WINDOW.setup(&window),
        None => Ok(()),
    }
}

#[tauri::command]
pub(crate) fn shape_preview(window: WebviewWindow, ratio: f64) -> CmdResult {
    let size = preview_size(ratio);
    macos::with_ns_window(&window, move |ns_window| {
        ns_window.setFrame_display(NSRect::new(ns_window.frame().origin, size), true);
    })?;
    Ok(())
}

fn preview_size(ratio: f64) -> NSSize {
    let ratio = ratio.clamp(0.5, 2.5);
    let width = (AREA * ratio).sqrt().round();
    NSSize::new(width, (width / ratio).round())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PreviewKey {
    Edit,
    Copy,
    Save,
}

impl KeySet for PreviewKey {
    const KEYS: &'static [Self] = &[Self::Edit, Self::Copy, Self::Save];

    fn shortcut(self) -> Shortcut {
        match self {
            Self::Edit => Shortcut::new(None, Code::KeyE),
            Self::Copy => Shortcut::new(Some(Modifiers::SUPER), Code::KeyC),
            Self::Save => Shortcut::new(Some(Modifiers::SUPER), Code::KeyS),
        }
    }

    fn press(self, app: &AppHandle) {
        let _ = PageEvent::PreviewKey(self).send_to(app, LABEL);
    }
}

fn hold_keys(app: &AppHandle, is_over: bool) {
    let keys = if is_over {
        PreviewKey::take(app)
    } else {
        PreviewKey::give_back(app)
    };
    if let Err(err) = keys {
        log::warn!("could not take or give back the preview keys: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_size_should_keep_the_area_and_take_the_frames_shape() {
        let size = |ratio| {
            let size = preview_size(ratio);
            (size.width, size.height)
        };
        assert_eq!(size(16.0 / 10.0), (360.0, 225.0));
        assert_eq!(size(1.0), (285.0, 285.0));
        assert_eq!(size(9.0 / 16.0), (213.0, 379.0));
        assert_eq!(size(10.0), size(2.5));
    }
}
