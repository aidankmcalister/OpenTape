//! The record bar: placed top center under the menu bar, like Screen Studio, where it doesn't
//! cover what you're picking. Its window stays one size; the pill inside animates, the glass
//! follows it, and clicks beside the pill pass through to the apps underneath.

use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use objc2::MainThreadMarker;
use objc2_foundation::NSSize;
use tauri::{LogicalPosition, State, WebviewWindow};

use crate::glass;
use crate::macos_window;
use crate::sources::Frame;

/// Gap between the menu bar and the record bar, in points.
const TOP_GAP: f64 = 12.0;
/// How often the pointer is checked to decide whether clicks reach the bar.
const CLICK_CHECK_EVERY: Duration = Duration::from_millis(33);

/// The pill's current width, shared with the click-through check.
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
    animate: bool,
) -> Result<(), String> {
    pill_width.set(width);
    macos_window::with_ns_window(&window, move |ns_window| {
        macos_window::widen_to(ns_window, width);
        glass::shape(ns_window, NSSize::new(width, height), animate);
    })
    .map_err(|err| err.to_string())
}

pub fn add_glass(bar: &WebviewWindow) -> tauri::Result<()> {
    macos_window::with_ns_window(bar, |ns_window| {
        if let Some(main_thread) = MainThreadMarker::new() {
            glass::add(ns_window, main_thread);
        }
    })
}

pub fn pass_clicks_beside_pill(bar: WebviewWindow, pill_width: PillWidth) {
    thread::spawn(move || {
        loop {
            let width = pill_width.get();
            let checked = macos_window::with_ns_window(&bar, move |ns_window| {
                macos_window::pass_clicks_beside(ns_window, width);
            });
            if checked.is_err() {
                return;
            }
            thread::sleep(CLICK_CHECK_EVERY);
        }
    });
}

pub fn place_at_top(bar: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = bar.primary_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let usable = Frame {
        x: f64::from(area.position.x) / scale,
        y: f64::from(area.position.y) / scale,
        width: f64::from(area.size.width) / scale,
        height: f64::from(area.size.height) / scale,
    };
    let bar_width = f64::from(bar.outer_size()?.width) / bar.scale_factor()?;
    let (x, y) = top_center(usable, bar_width);
    bar.set_position(LogicalPosition::new(x, y))
}

/// The bar's top-left corner when centered at the top of `usable` (the screen minus the menu bar).
fn top_center(usable: Frame, bar_width: f64) -> (f64, f64) {
    let x = usable.x + ((usable.width - bar_width) / 2.0).max(0.0);
    (x.round(), usable.y + TOP_GAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_center_should_center_under_the_menu_bar() {
        let usable = Frame {
            x: 0.0,
            y: 33.0,
            width: 1512.0,
            height: 949.0,
        };
        assert_eq!(top_center(usable, 420.0), (546.0, 45.0));
    }
}
