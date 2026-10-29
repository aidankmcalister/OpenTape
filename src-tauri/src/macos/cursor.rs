use anyhow::{Context, Result};
use base64::Engine;
use objc2::{AllocAnyThread, Message, rc::Retained};
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSColor, NSCursor, NSDeviceRGBColorSpace,
    NSGraphicsContext, NSImage, NSShadow,
};
use objc2_foundation::{NSData, NSDictionary, NSPoint, NSRect, NSSize, NSString};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

type Cursor = fn() -> Retained<NSCursor>;

pub(crate) const KINDS: [(&str, Cursor); 3] = [
    ("arrow", NSCursor::arrowCursor),
    ("pointer", NSCursor::pointingHandCursor),
    ("text", NSCursor::IBeamCursor),
];

const SHARPNESS: f64 = 8.0;
const SYSTEM_CURSORS: &str = "/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Resources/cursors";

pub(crate) struct KindReader {
    known: Vec<(&'static str, Vec<u8>)>,
}

impl KindReader {
    pub(crate) fn new() -> Self {
        Self {
            known: KINDS
                .iter()
                .map(|(kind, cursor)| (*kind, tiff(&cursor())))
                .collect(),
        }
    }

    pub(crate) fn current(&self) -> &'static str {
        #[allow(deprecated)]
        let Some(cursor) = NSCursor::currentSystemCursor() else {
            return "arrow";
        };
        let now = tiff(&cursor);
        self.known
            .iter()
            .find(|(_, known)| *known == now)
            .map_or("arrow", |(kind, _)| kind)
    }
}

fn tiff(cursor: &NSCursor) -> Vec<u8> {
    cursor
        .image()
        .TIFFRepresentation()
        .map(|data| data.to_vec())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct CursorImage {
    pub(crate) kind: String,
    pub(crate) png: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) hot_x: f64,
    pub(crate) hot_y: f64,
}

fn sharp_png(image: &NSImage, kind: &str) -> Result<Retained<NSData>> {
    let size = image.size();
    let vector = (kind == "pointer").then(|| {
        let path = NSString::from_str(&format!("{SYSTEM_CURSORS}/pointinghand/cursor.pdf"));
        NSImage::initWithContentsOfFile(NSImage::alloc(), &path)
    });
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            (size.width * SHARPNESS) as isize,
            (size.height * SHARPNESS) as isize,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }
    .context("could not make a cursor bitmap")?;
    rep.setSize(size);
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)
        .context("could not draw a cursor")?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    let source = match vector.flatten() {
        Some(pdf) => {
            let shadow = NSShadow::new();
            shadow.setShadowBlurRadius(2.0);
            shadow.setShadowOffset(NSSize::new(0.0, -1.0));
            shadow.setShadowColor(Some(&NSColor::colorWithWhite_alpha(0.0, 0.45)));
            shadow.set();
            pdf
        }
        None => image.retain(),
    };
    source.drawInRect(NSRect::new(NSPoint::ZERO, size));
    NSGraphicsContext::restoreGraphicsState_class();
    unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .context("could not turn a cursor into a PNG")
}

pub(crate) fn cursor_images() -> Result<Vec<CursorImage>> {
    KINDS
        .iter()
        .map(|(kind, cursor)| {
            let cursor = cursor();
            let image = cursor.image();
            let png = sharp_png(&image, kind)?;
            let (size, spot) = (image.size(), cursor.hotSpot());
            Ok(CursorImage {
                kind: kind.to_string(),
                png: base64::engine::general_purpose::STANDARD.encode(png.to_vec()),
                width: size.width,
                height: size.height,
                hot_x: spot.x,
                hot_y: spot.y,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "prints what this Mac reports; run by hand"]
    #[allow(deprecated)]
    fn probe() {
        objc2_app_kit::NSApplicationLoad();
        if let Ok(path) = std::env::var("CURSOR_IMAGES_TO") {
            std::fs::write(
                path,
                serde_json::to_string(&cursor_images().unwrap()).unwrap(),
            )
            .unwrap();
        }
        for image in cursor_images().unwrap() {
            println!(
                "image {} {}x{} hot {},{} png {} chars",
                image.kind,
                image.width,
                image.height,
                image.hot_x,
                image.hot_y,
                image.png.len()
            );
        }
        let current = NSCursor::currentSystemCursor().expect("a current cursor");
        let current_tiff = current
            .image()
            .TIFFRepresentation()
            .map(|data| data.to_vec());
        let spot = current.hotSpot();
        let size = current.image().size();
        println!(
            "current hot {:?},{:?} size {:?}x{:?}",
            spot.x, spot.y, size.width, size.height
        );
        for (kind, cursor) in KINDS {
            let cursor = cursor();
            let spot = cursor.hotSpot();
            let size = cursor.image().size();
            let tiff = cursor
                .image()
                .TIFFRepresentation()
                .map(|data| data.to_vec());
            println!(
                "{kind}: hot {},{} size {}x{} tiff {} same as current {}",
                spot.x,
                spot.y,
                size.width,
                size.height,
                tiff.as_ref().map_or(0, Vec::len),
                tiff == current_tiff
            );
        }
    }
}
