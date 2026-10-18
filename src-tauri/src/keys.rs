//! Esc, Return and Tab while the picker is open. They're registered system-wide for that time,
//! because the overlays aren't reliably the focused window.

use tauri::{AppHandle, Emitter, Manager, Wry, plugin::TauriPlugin};
use tauri_plugin_global_shortcut::{Code, Error, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::picker::{self, PickerState};

const KEYS: [Code; 3] = [Code::Escape, Code::Enter, Code::Tab];

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                on_key(app, shortcut.key);
            }
        })
        .build()
}

pub fn capture(app: &AppHandle) -> Result<(), Error> {
    app.global_shortcut().register_multiple(shortcuts())
}

pub fn release(app: &AppHandle) -> Result<(), Error> {
    app.global_shortcut().unregister_multiple(shortcuts())
}

fn shortcuts() -> [Shortcut; 3] {
    KEYS.map(|key| Shortcut::new(None, key))
}

fn on_key(app: &AppHandle, key: Code) {
    match key {
        Code::Escape => {
            let state = app.state::<PickerState>();
            let _ = picker::close(app, &state);
        }
        Code::Enter => {
            let _ = app.emit("picker-key", "Enter");
        }
        Code::Tab => {
            let _ = app.emit("picker-key", "Tab");
        }
        _ => {}
    }
}
