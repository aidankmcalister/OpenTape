//! The record bar: bottom center, right above the Dock. Its window stays one size; the pill
//! inside animates, the glass follows it, and clicks beside the pill pass through to the apps
//! underneath. It also offers the cameras and microphones, listed here.

use std::sync::atomic::{AtomicU64, Ordering};

use cidre::{av, ns};
use objc2::MainThreadOnly;
use objc2_app_kit::NSWindow;
use objc2_foundation::NSSize;
use serde::Serialize;
use tauri::{Manager, WebviewWindow};
use ts_rs::TS;

use super::floating::{Anchor, Behaviour, Floating};
use crate::geometry;
use crate::macos::{
    self,
    glass::{self, Animation},
};
use crate::util::CmdResult;

pub(crate) const LABEL: &str = "bar";

/// Clicks beside the pill pass through to the apps underneath.
pub(crate) static WINDOW: Floating = Floating::new(Behaviour {
    label: LABEL,
    anchor: Anchor::BottomCenter,
    keeps_its_spot: true,
    on_pointer: let_clicks_through,
    hover: None,
});
/// The pill's current width, as `f64` bits, shared with the pointer loop.
static PILL_WIDTH: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Device {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Devices {
    pub cameras: Vec<Device>,
    pub microphones: Vec<Device>,
}

/// Listing the cameras and microphones needs no permission.
#[tauri::command]
pub(crate) fn list_devices() -> Devices {
    Devices {
        cameras: discover_devices(
            &[
                av::CaptureDeviceType::built_in_wide_angle_camera(),
                av::CaptureDeviceType::external(),
            ],
            av::MediaType::video(),
        ),
        microphones: discover_devices(
            &[av::CaptureDeviceType::microphone()],
            av::MediaType::audio(),
        ),
    }
}

fn discover_devices(types: &[&av::CaptureDeviceType], media: &av::MediaType) -> Vec<Device> {
    let types = ns::Array::from_slice(types);
    av::CaptureDeviceDiscoverySession::with_device_types_media_and_pos(
        &types,
        Some(media),
        av::CaptureDevicePos::Unspecified,
    )
    .devices()
    .iter()
    .map(|device| Device {
        id: device.unique_id().to_string(),
        name: device.localized_name().to_string(),
    })
    .collect()
}

/// Called whenever the pill changes size, so the glass and the click area follow it.
#[tauri::command]
pub(crate) fn shape_bar(
    window: WebviewWindow,
    width: f64,
    height: f64,
    animation: Option<Animation>,
) -> CmdResult {
    PILL_WIDTH.store(width.to_bits(), Ordering::Relaxed);
    macos::with_ns_window(&window, move |ns_window| {
        // Widens the window around its bottom center when the pill doesn't fit. It never
        // narrows: the see-through sides let clicks pass instead, so the pill can animate
        // without a resize.
        let frame = ns_window.frame();
        if width > frame.size.width {
            let size = NSSize::new(width, frame.size.height);
            ns_window.setFrame_display(geometry::keep_bottom_center(frame, size), true);
        }
        glass::shape(ns_window, NSSize::new(width, height), animation);
        let_clicks_through(ns_window);
    })?;
    Ok(())
}

/// The bar is hidden in the config, so it doesn't flash in the middle before it's placed.
pub(crate) fn setup(bar: &WebviewWindow) -> tauri::Result<()> {
    WINDOW.setup(bar)?;
    macos::with_ns_window(bar, |ns_window| glass::add(ns_window, ns_window.mtm()))?;
    WINDOW.show_on_main_display(bar.app_handle());
    Ok(())
}

/// Lets clicks through everywhere except the centered pill. Runs as the pointer moves and as
/// the pill changes size.
fn let_clicks_through(ns_window: &NSWindow) {
    let width = f64::from_bits(PILL_WIDTH.load(Ordering::Relaxed));
    let pointer = ns_window.mouseLocationOutsideOfEventStream();
    let window_width = ns_window.frame().size.width;
    let is_over_pill = (pointer.x - window_width / 2.0).abs() <= width / 2.0;
    if ns_window.ignoresMouseEvents() == is_over_pill {
        ns_window.setIgnoresMouseEvents(!is_over_pill);
    }
}
