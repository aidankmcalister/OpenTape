//! The cameras and microphones the record bar offers. Listing them needs no permission.

use cidre::{av, ns};
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct Device {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct Devices {
    pub cameras: Vec<Device>,
    pub microphones: Vec<Device>,
}

#[tauri::command]
pub(crate) fn list_devices() -> Devices {
    Devices {
        cameras: discover(
            &[
                av::CaptureDeviceType::built_in_wide_angle_camera(),
                av::CaptureDeviceType::external(),
            ],
            av::MediaType::video(),
        ),
        microphones: discover(
            &[av::CaptureDeviceType::microphone()],
            av::MediaType::audio(),
        ),
    }
}

fn discover(types: &[&av::CaptureDeviceType], media: &av::MediaType) -> Vec<Device> {
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
