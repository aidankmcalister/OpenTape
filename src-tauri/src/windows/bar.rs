//! The record bar: bottom center, just above the Dock. Its window stays one size; the pill
//! inside animates, the glass follows it, and clicks beside the pill pass through to the apps
//! underneath.

use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use objc2::MainThreadOnly;
use objc2_app_kit::NSPopUpMenuWindowLevel;
use objc2_foundation::NSSize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::follow::{self, Anchor};
use super::pointer::{self, CHECK_EVERY};
use crate::error::CmdResult;
use crate::macos::glass::{self, Animation};
use crate::macos::window as macos_window;
use crate::util::Poller;

pub(crate) const LABEL: &str = "bar";

/// Watches the pointer while the bar shows.
static POINTER_LOOP: Poller = Poller::new();

/// The pill's current width, shared with the pointer check.
#[derive(Default, Clone)]
pub(crate) struct PillWidth(Arc<AtomicU64>);

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
pub(crate) fn shape_bar(
    window: WebviewWindow,
    pill_width: State<'_, PillWidth>,
    width: f64,
    height: f64,
    animation: Option<Animation>,
) -> CmdResult {
    pill_width.set(width);
    macos_window::with_ns_window(&window, move |ns_window| {
        macos_window::widen_to(ns_window, width);
        glass::shape(ns_window, NSSize::new(width, height), animation);
    })?;
    Ok(())
}

/// The bar is hidden in the config, so it doesn't flash in the middle before it's placed.
pub(crate) fn setup(bar: WebviewWindow, pill_width: PillWidth) -> tauri::Result<()> {
    super::never_close(&bar);
    macos_window::with_ns_window(&bar, |ns_window| {
        let main_thread = ns_window.mtm();
        macos_window::float_panel(ns_window, NSPopUpMenuWindowLevel);
        glass::add(ns_window, main_thread);
        follow::place_on_primary_screen(ns_window, main_thread, Anchor::BottomCenter);
        ns_window.orderFrontRegardless();
    })?;
    watch_pointer(bar, pill_width);
    Ok(())
}

/// Brings the bar back, on the display you're pointing at, without taking focus from the app
/// you're in.
pub(crate) fn show(app: &AppHandle) {
    if let Some(bar) = app.get_webview_window(LABEL) {
        // Fails only while the app quits.
        let _ = macos_window::with_ns_window(&bar, |ns_window| {
            follow::follow(ns_window, Anchor::BottomCenter);
            ns_window.orderFrontRegardless();
        });
        watch_pointer(bar, app.state::<PillWidth>().inner().clone());
    }
}

pub(crate) fn hide(app: &AppHandle) {
    POINTER_LOOP.stop();
    super::hide(app, LABEL);
}

/// While the bar shows: keeps clicks beside the pill passing through to the apps underneath,
/// and follows clicks to other displays. The main thread is only asked when the pointer or
/// the pill changed, so a still pointer costs next to nothing.
fn watch_pointer(bar: WebviewWindow, pill_width: PillWidth) {
    let mut watch = pointer::Watch::default();
    let mut last_width = 0.0;
    POINTER_LOOP.start(CHECK_EVERY, move || {
        let change = watch.update(pointer::now());
        let width = pill_width.get();
        if !change.moved && !change.clicked && width == last_width {
            return true;
        }
        last_width = width;
        macos_window::with_ns_window(&bar, move |ns_window| {
            if change.clicked {
                follow::follow(ns_window, Anchor::BottomCenter);
            }
            macos_window::pass_clicks_beside(ns_window, width);
        })
        .is_ok()
    });
}
