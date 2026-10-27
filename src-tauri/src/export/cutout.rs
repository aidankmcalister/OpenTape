use std::path::Path;
use std::ptr::null_mut;

use super::{ExportGradient, ExportLayout, PixelRect, file_url};
use anyhow::{Context, Result};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_foundation::{CFRetained, CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGBitmapContextCreateImage, CGBlendMode, CGColor, CGColorSpace,
    CGContext, CGGradient, CGGradientDrawingOptions, CGImage, CGImageAlphaInfo, CGPath,
    kCGColorSpaceSRGB,
};
use objc2_core_image::{CIContext, CIImage, kCIImageApplyOrientationProperty};
use objc2_foundation::{NSDictionary, NSNumber, NSString};

pub(super) fn canvas(
    width: usize,
    height: usize,
) -> Result<(CFRetained<CGColorSpace>, CFRetained<CGContext>)> {
    let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
        .context("macOS has no sRGB color space")?;
    let context = unsafe {
        CGBitmapContextCreate(
            null_mut(),
            width,
            height,
            8,
            0,
            Some(&srgb),
            CGImageAlphaInfo::PremultipliedLast.0,
        )
    }
    .context("could not make a picture to draw in")?;
    Ok((srgb, context))
}

pub(super) fn cutout(layout: &ExportLayout, picture: Option<&Path>) -> Result<Retained<CIImage>> {
    let (width, height) = (layout.width as usize, layout.height as usize);
    let (srgb, context) = canvas(width, height)?;
    let context = Some(&*context);

    if let Some(picture) = picture {
        let picture = background_picture(picture)?;
        let size = CGSize::new(
            CGImage::width(Some(&picture)) as f64,
            CGImage::height(Some(&picture)) as f64,
        );
        let rect = cover(size, width as f64, height as f64);
        CGContext::draw_image(context, rect, Some(&picture));
    } else {
        let gradient = gradient(&srgb, &layout.background)?;
        let (start, end) = gradient_line(layout.background.angle, width as f64, height as f64);
        let extend = CGGradientDrawingOptions::DrawsBeforeStartLocation
            | CGGradientDrawingOptions::DrawsAfterEndLocation;
        CGContext::draw_linear_gradient(context, Some(&gradient), start, end, extend);
    }

    let hole = rounded_rect(&layout.recording, layout.radius, layout.height);
    CGContext::save_g_state(context);
    let shadow = CGColor::new_srgb(0.0, 0.0, 0.0, layout.shadow.opacity);
    let offset = CGSize::new(0.0, -layout.shadow.offset_y);
    CGContext::set_shadow_with_color(context, offset, layout.shadow.blur, Some(&shadow));
    CGContext::add_path(context, Some(&hole));
    CGContext::fill_path(context);
    CGContext::restore_g_state(context);

    CGContext::set_blend_mode(context, CGBlendMode::Clear);
    CGContext::add_path(context, Some(&hole));
    CGContext::fill_path(context);

    if let Some(border) = &layout.border {
        let [red, green, blue] = rgb(&border.color)?;
        let color = CGColor::new_srgb(red, green, blue, border.opacity);
        CGContext::set_blend_mode(context, CGBlendMode::Normal);
        CGContext::add_path(context, Some(&hole));
        CGContext::clip(context);
        CGContext::set_stroke_color_with_color(context, Some(&color));
        CGContext::set_line_width(context, border.width * 2.0);
        CGContext::add_path(context, Some(&hole));
        CGContext::stroke_path(context);
    }

    let image = CGBitmapContextCreateImage(context).context("could not draw the background")?;
    Ok(unsafe { CIImage::imageWithCGImage(&image) })
}

pub(super) fn moved(image: &CIImage, tx: f64, ty: f64) -> Retained<CIImage> {
    let (a, b, c, d) = (1.0, 0.0, 0.0, 1.0);
    unsafe { image.imageByApplyingTransform(CGAffineTransform { a, b, c, d, tx, ty }) }
}

fn background_picture(path: &Path) -> Result<Retained<CGImage>> {
    let upright = NSNumber::new_bool(true);
    let options = NSDictionary::<NSString, AnyObject>::from_slices(
        &[unsafe { kCIImageApplyOrientationProperty }],
        &[upright.as_ref()],
    );
    let source =
        unsafe { CIImage::imageWithContentsOfURL_options(&file_url(path), Some(&options)) }
            .with_context(|| format!("could not read the background picture {}", path.display()))?;
    let context = unsafe { CIContext::context() };
    unsafe { context.createCGImage_fromRect(&source, source.extent()) }
        .context("could not draw the background picture")
}

fn cover(picture: CGSize, width: f64, height: f64) -> CGRect {
    let scale = (width / picture.width).max(height / picture.height);
    let size = CGSize::new(picture.width * scale, picture.height * scale);
    let origin = CGPoint::new((width - size.width) / 2.0, (height - size.height) / 2.0);
    CGRect::new(origin, size)
}

fn gradient(space: &CGColorSpace, background: &ExportGradient) -> Result<CFRetained<CGGradient>> {
    let mut components = Vec::new();
    let mut locations = Vec::new();
    for stop in &background.stops {
        let [red, green, blue] = rgb(&stop.color)?;
        components.extend([red, green, blue, 1.0]);
        locations.push(stop.at);
    }
    unsafe {
        CGGradient::with_color_components(
            Some(space),
            components.as_ptr(),
            locations.as_ptr(),
            locations.len(),
        )
    }
    .context("could not make the background's gradient")
}

fn gradient_line(angle: f64, width: f64, height: f64) -> (CGPoint, CGPoint) {
    let (dx, dy) = (angle.to_radians().sin(), -angle.to_radians().cos());
    let half = (width * dx.abs() + height * dy.abs()) / 2.0;
    let point = |sign: f64| {
        let (x, y) = (
            width / 2.0 + sign * dx * half,
            height / 2.0 + sign * dy * half,
        );
        CGPoint::new(x, height - y)
    };
    (point(-1.0), point(1.0))
}

fn rounded_rect(rect: &PixelRect, radius: f64, height: u32) -> CFRetained<CGPath> {
    let flipped = CGRect::new(
        CGPoint::new(rect.x, f64::from(height) - rect.y - rect.height),
        CGSize::new(rect.width, rect.height),
    );
    unsafe { CGPath::with_rounded_rect(flipped, radius, radius, std::ptr::null()) }
}

pub(super) fn rgb(hex: &str) -> Result<[f64; 3]> {
    let digits = hex.strip_prefix('#').filter(|digits| digits.len() == 6);
    let digits = digits.with_context(|| format!("{hex:?} isn't a color like #2a9d8f"))?;
    let channel = |at: usize| -> Result<f64> {
        Ok(f64::from(u8::from_str_radix(&digits[at..at + 2], 16)?) / 255.0)
    };
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: CGPoint, x: f64, y: f64) -> bool {
        (a.x - x).abs() < 1e-9 && (a.y - y).abs() < 1e-9
    }
    #[test]
    fn gradient_lines_run_the_way_css_draws_them() {
        let (start, end) = gradient_line(90.0, 100.0, 50.0);
        assert!(close(start, 0.0, 25.0) && close(end, 100.0, 25.0));
        let (start, end) = gradient_line(180.0, 100.0, 50.0);
        assert!(close(start, 50.0, 50.0) && close(end, 50.0, 0.0));
        let (start, end) = gradient_line(135.0, 100.0, 100.0);
        assert!(close(start, 0.0, 100.0) && close(end, 100.0, 0.0));
    }

    #[test]
    fn a_background_picture_covers_the_frame_from_its_center() {
        let wide = cover(CGSize::new(400.0, 100.0), 200.0, 100.0);
        assert!(close(wide.origin, -100.0, 0.0));
        assert_eq!((wide.size.width, wide.size.height), (400.0, 100.0));
        let tall = cover(CGSize::new(100.0, 100.0), 200.0, 100.0);
        assert!(close(tall.origin, 0.0, -50.0));
        assert_eq!((tall.size.width, tall.size.height), (200.0, 200.0));
    }

    #[test]
    fn colors_read_from_hex_and_bad_ones_say_why() {
        assert_eq!(rgb("#ff0000").unwrap(), [1.0, 0.0, 0.0]);
        assert!(rgb("2a9d8f").is_err());
        assert!(rgb("#2a9d8").is_err());
    }
}
