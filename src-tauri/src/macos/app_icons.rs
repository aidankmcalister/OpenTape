//! App icons as small PNG data URLs, so the picker can show the app it's about to record.
//!
//! This runs off the main thread, while the picker lists what's on screen, and that's allowed:
//! none of these classes is main-thread-only. Apple documents `NSRunningApplication` as thread
//! safe, and an `NSImage` as safe to draw from a secondary thread as long as no other thread
//! changes it at the same time. Nothing changes these icons, and each bitmap is made and read by
//! one thread. objc2-app-kit encodes the same rules: none of these calls asks for a
//! `MainThreadMarker`.

use base64::{Engine, engine::general_purpose::STANDARD};
use objc2::AllocAnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};

use super::main_thread;

/// 32 points on a 2x display.
const ICON_PIXELS: f64 = 64.0;

/// `None` when the app has no icon, or macOS fails to draw it; the picker then shows none.
pub(crate) fn data_url(pid: u32) -> Option<String> {
    let png = main_thread::catch(|| png(pid)).unwrap_or_else(|err| {
        eprintln!("could not draw the icon of app {pid}: {err:#}");
        None
    });
    png.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn png(pid: u32) -> Option<Vec<u8>> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid.try_into().ok()?)?;
    let icon = app.icon()?;
    let mut rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(ICON_PIXELS, ICON_PIXELS),
    );
    // SAFETY: `rect` is a live, writable NSRect for the whole call, which is all the method
    // asks of it. No context and no hints are both allowed.
    let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
    // SAFETY: the method is unsafe because the dictionary's values are untyped. An empty
    // dictionary has none, and it's valid for every file type.
    let data = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(data.to_vec())
}
