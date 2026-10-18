//! The record bar: bottom center, just above the Dock. Its window stays one size; the pill inside animates, the glass follows it, and clicks
//! beside the pill pass through to the apps underneath.

use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use objc2::MainThreadMarker;
use objc2_app_kit::NSPopUpMenuWindowLevel;
use objc2_foundation::NSSize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::follow::{self, Anchor};
use crate::glass::{self, Animation};
use crate::macos_window;

pub const LABEL: &str = "bar";

/// How often the pointer is checked to decide whether clicks reach the bar.
const CLICK_THROUGH_CHECK_EVERY: Duration = Duration::from_millis(33);

/// The pill's current width, shared with the pointer check.
#[derive(Default, Clone)]
pub struct PillWidth(Arc<AtomicU64>);

impl PillWidth {
    fn get(&self) -> f64 {
        f64::from_bits(self.0.load(Ordering::Relaxed))
    }

    fn set(&self, width: f64) {
        self.0.store(width.to_bits(), Ordering::Relaxed);
    }
}

/// Called whenever the pill changes size, so the glass and the click area follow it.
#[tauri::command]
pub fn shape_bar(
    window: WebviewWindow,
    pill_width: State<'_, PillWidth>,
    width: f64,
    height: f64,
    animation: Option<Animation>,
) -> Result<(), String> {
    pill_width.set(width);
    macos_window::with_ns_window(&window, move |ns_window| {
        macos_window::widen_to(ns_window, width);
        glass::shape(ns_window, NSSize::new(width, height), animation);
    })
    .map_err(|err| err.to_string())
}

/// The bar is hidden in the config, so it doesn't flash in the middle before it's placed.
pub fn setup(bar: WebviewWindow, pill_width: PillWidth) -> tauri::Result<()> {
    macos_window::with_ns_window(&bar, |ns_window| {
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        macos_window::float_panel(ns_window, NSPopUpMenuWindowLevel);
        glass::add(ns_window, main_thread);
        follow::place_on_primary_screen(ns_window, main_thread, Anchor::BottomCenter);
        ns_window.orderFrontRegardless();
    })?;
    pass_clicks_beside_pill(bar, pill_width);
    Ok(())
}

/// The bar steps aside while the recording preview is showing.
pub fn hide(app: &AppHandle) {
    if let Some(bar) = app.get_webview_window(LABEL) {
        let _ = bar.hide();
    }
}

/// Brings the bar back without taking focus from the app you're in.
pub fn show(app: &AppHandle) {
    if let Some(bar) = app.get_webview_window(LABEL) {
        let _ = macos_window::with_ns_window(&bar, |ns_window| ns_window.orderFrontRegardless());
    }
}

/// Keeps clicks beside the pill passing through to the apps underneath.
fn pass_clicks_beside_pill(bar: WebviewWindow, pill_width: PillWidth) {
    thread::spawn(move || {
        loop {
            let width = pill_width.get();
            let checked = macos_window::with_ns_window(&bar, move |ns_window| {
                macos_window::pass_clicks_beside(ns_window, width);
            });
            if checked.is_err() {
                return;
            }
            thread::sleep(CLICK_THROUGH_CHECK_EVERY);
        }
    });
}
