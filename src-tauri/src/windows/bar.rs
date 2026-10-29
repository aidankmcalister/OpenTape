use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use cidre::{av, ns};
use objc2::MainThreadOnly;
use objc2_app_kit::NSWindow;
use objc2_foundation::NSSize;
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
use ts_rs::TS;

use super::floating::{Anchor, Behavior, Floating, Hover};
use crate::PageEvent;
use crate::geometry;
use crate::macos::{
    self,
    glass::{self, Animation},
};
use crate::util::CmdResult;

pub(crate) const LABEL: &str = "bar";

static SHOWS_WHEN_READY: AtomicBool = AtomicBool::new(false);

pub(crate) static WINDOW: Floating = Floating::new(Behavior {
    label: LABEL,
    anchor: Anchor::BottomCenter,
    keeps_its_spot: true,
    on_pointer: let_clicks_through,
    hover: Some(Hover {
        event: PageEvent::BarPointer,
        on_enter_or_leave: |_, _| {},
    }),
});
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

#[tauri::command]
pub(crate) fn shape_bar(
    window: WebviewWindow,
    width: f64,
    height: f64,
    animation: Option<Animation>,
) -> CmdResult {
    PILL_WIDTH.store(width.to_bits(), Ordering::Relaxed);
    macos::with_ns_window(&window, move |ns_window| {
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

pub(crate) fn show_when_ready() {
    SHOWS_WHEN_READY.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub(crate) fn bar_ready(app: AppHandle) {
    if SHOWS_WHEN_READY.swap(false, Ordering::Relaxed) {
        WINDOW.show_on_main_display(&app);
    }
}

#[tauri::command]
pub(crate) fn hide_bar(app: AppHandle) {
    WINDOW.hide(&app);
}

pub(crate) fn setup(bar: &WebviewWindow) -> tauri::Result<()> {
    WINDOW.setup(bar)?;
    macos::with_ns_window(bar, |ns_window| glass::add(ns_window, ns_window.mtm()))
}

fn let_clicks_through(ns_window: &NSWindow) {
    let width = f64::from_bits(PILL_WIDTH.load(Ordering::Relaxed));
    let pointer = ns_window.mouseLocationOutsideOfEventStream();
    let window_width = ns_window.frame().size.width;
    let is_over_pill = (pointer.x - window_width / 2.0).abs() <= width / 2.0;
    if ns_window.ignoresMouseEvents() == is_over_pill {
        ns_window.setIgnoresMouseEvents(!is_over_pill);
    }
}
