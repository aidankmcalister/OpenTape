//! Puts a file on the clipboard the way Finder's Copy does, so it pastes as the file itself.

use std::path::Path;

use objc2::runtime::ProtocolObject;
use objc2_app_kit::NSPasteboard;
use objc2_foundation::{NSArray, NSString, NSURL};

/// Call on the main thread.
pub(crate) fn copy_file(path: &Path) {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.display().to_string()));
    let objects = NSArray::from_retained_slice(&[ProtocolObject::from_retained(url)]);
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    pasteboard.writeObjects(&objects);
}
