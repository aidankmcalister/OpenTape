//! The recording preview: after you stop, a thumbnail waits in the bottom-left corner, like
//! Screen Studio's quick share, to save, copy, edit or close the recording. It floats like the
//! bar, and takes E, ⌘C and ⌘S while the pointer is over it.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use ts_rs::TS;

use super::floating::{Anchor, Behaviour, Floating, Hover};
use crate::{KeySet, PageEvent};

pub(crate) const LABEL: &str = "preview";

/// A page in an inactive macOS window gets no mouse moves, so Rust tells it where the pointer is.
pub(crate) static WINDOW: Floating = Floating::new(Behaviour {
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

/// E, ⌘C and ⌘S, taken only while the pointer is over the preview, so ⌘C and ⌘S work as usual
/// everywhere else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PreviewKey {
    Edit,
    Copy,
    Save,
}

impl KeySet for PreviewKey {
    const KEYS: [Self; 3] = [Self::Edit, Self::Copy, Self::Save];

    fn shortcut(self) -> Shortcut {
        match self {
            Self::Edit => Shortcut::new(None, Code::KeyE),
            Self::Copy => Shortcut::new(Some(Modifiers::SUPER), Code::KeyC),
            Self::Save => Shortcut::new(Some(Modifiers::SUPER), Code::KeyS),
        }
    }

    /// The page runs it, as if clicked.
    fn press(self, app: &AppHandle) {
        // Fails only once the preview is gone, and then there's nothing to act on.
        let _ = PageEvent::PreviewKey(self).send_to(app, LABEL);
    }
}

/// Takes the preview's keys while the pointer is over it, and gives them back when it leaves.
fn hold_keys(app: &AppHandle, is_over: bool) {
    let keys = if is_over {
        PreviewKey::take(app)
    } else {
        PreviewKey::give_back(app)
    };
    // Without the keys, the preview's buttons still work.
    if let Err(err) = keys {
        eprintln!("could not take or give back the preview keys: {err}");
    }
}
