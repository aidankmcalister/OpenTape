//! App icons as small PNG data URLs, so the picker can show the app it's about to record.

use base64::{Engine, engine::general_purpose::STANDARD};
use objc2::AllocAnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};

/// 32 points on a 2x display.
const ICON_PIXELS: f64 = 64.0;

pub fn data_url(pid: u32) -> Option<String> {
    png(pid).map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn png(pid: u32) -> Option<Vec<u8>> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid.try_into().ok()?)?;
    let icon = app.icon()?;
    let mut rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(ICON_PIXELS, ICON_PIXELS),
    );
    // SAFETY: `rect` is a valid, live NSRect for the duration of the call.
    let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
    // SAFETY: an empty properties dictionary is valid for every file type.
    let data = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(data.to_vec())
}
