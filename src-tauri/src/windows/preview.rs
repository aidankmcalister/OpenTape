use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use ts_rs::TS;

use super::floating::{Anchor, Behavior, Floating, Hover};
use crate::{KeySet, PageEvent};

pub(crate) const LABEL: &str = "preview";

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
