//! Thin wrappers over macOS (AppKit) features Tauri doesn't cover: floating panels, the frosted
//! glass, native alerts, system-wide keys, the clipboard and app icons.

pub(crate) mod alert;
pub(crate) mod app_icons;
pub(crate) mod glass;
pub(crate) mod keys;
pub(crate) mod pasteboard;
pub(crate) mod window;
