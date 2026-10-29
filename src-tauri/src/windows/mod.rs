pub(crate) mod bar;
pub(crate) mod editor;
mod floating;
pub(crate) mod preview;

use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use tauri::window::Color;
use tauri::{
    AppHandle, LogicalPosition, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::geometry;

pub(crate) fn never_close(window: &WebviewWindow) {
    window.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
}

pub(crate) fn show_dialog(
    app: &AppHandle,
    label: &str,
    style: impl FnOnce(
        WebviewWindowBuilder<'_, Wry, AppHandle>,
    ) -> WebviewWindowBuilder<'_, Wry, AppHandle>,
) -> tauri::Result<()> {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => style(
            WebviewWindowBuilder::new(app, label, WebviewUrl::default())
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .theme(Some(Theme::Dark))
                .background_color(Color(14, 14, 16, 255))
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(LogicalPosition::new(18.0, 27.0))
                .center(),
        )
        .build()?,
    };
    window.show()?;
    window.set_focus()
}

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
            y: geometry::flip(frame, primary_height).origin.y,
            inset: menu_bar.max(screen.safeAreaInsets().top),
        });
    }
    tops
}
