//! Keys taken system-wide for a while, because this app's floating windows aren't the focused
//! window: the picker's while it's open, and the preview's while the pointer is over it. What
//! each key does is up to the handler given to `plugin`.

use tauri::{AppHandle, Wry, plugin::TauriPlugin};
use tauri_plugin_global_shortcut::{
    Code, Error, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Escape,
    Enter,
    Tab,
    Edit,
    Copy,
    Save,
}

pub const PICKER: [Key; 3] = [Key::Escape, Key::Enter, Key::Tab];
/// Only while the pointer is over the preview, so ⌘C and ⌘S work as usual everywhere else.
pub const PREVIEW: [Key; 3] = [Key::Edit, Key::Copy, Key::Save];

impl Key {
    fn shortcut(self) -> Shortcut {
        match self {
            Key::Escape => Shortcut::new(None, Code::Escape),
            Key::Enter => Shortcut::new(None, Code::Enter),
            Key::Tab => Shortcut::new(None, Code::Tab),
            Key::Edit => Shortcut::new(None, Code::KeyE),
            Key::Copy => Shortcut::new(Some(Modifiers::SUPER), Code::KeyC),
            Key::Save => Shortcut::new(Some(Modifiers::SUPER), Code::KeyS),
        }
    }
}

pub fn plugin(on_key: fn(&AppHandle, Key)) -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            let pressed = PICKER
                .into_iter()
                .chain(PREVIEW)
                .find(|key| key.shortcut().id() == shortcut.id());
            if let (ShortcutState::Pressed, Some(key)) = (event.state, pressed) {
                on_key(app, key);
            }
        })
        .build()
}

pub fn capture(app: &AppHandle, keys: [Key; 3]) -> Result<(), Error> {
    app.global_shortcut()
        .register_multiple(keys.map(Key::shortcut))
}

pub fn release(app: &AppHandle, keys: [Key; 3]) -> Result<(), Error> {
    app.global_shortcut()
        .unregister_multiple(keys.map(Key::shortcut))
}
