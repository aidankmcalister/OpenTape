//! Export: the recording drawn in its look and written to an `.mp4` by AVFoundation.
//!
//! The page works out the layout with the same maths as the stage and sends plain pixel numbers,
//! so the stage and the export can't disagree. The look is the same on every frame, so it's drawn
//! once, as a cut-out: the background and the shadow, with a rounded hole where the recording
//! shows through. Each frame is that cut-out laid over the video, which keeps the recording's own
//! pixels untouched when it's exported at full size.
//!
//! The frames are read with the look applied and written by hand, rather than with an export
//! session, because an export session shrinks anything bigger than the recording back to its size.

use std::path::Path;
use std::ptr::{NonNull, null_mut};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderStatus, AVAssetReaderVideoCompositionOutput, AVAssetWriter,
    AVAssetWriterInput, AVAssetWriterStatus, AVAsynchronousCIImageFilteringRequest,
    AVFileTypeMPEG4, AVMediaTypeVideo, AVMutableVideoComposition, AVURLAsset,
    AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264,
    AVVideoCompressionPropertiesKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalDurationKey,
    AVVideoWidthKey,
};
use objc2_core_foundation::{CFRetained, CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGBitmapContextCreateImage, CGBlendMode, CGColor, CGColorSpace,
    CGContext, CGGradient, CGGradientDrawingOptions, CGImageAlphaInfo, CGPath, kCGColorSpaceSRGB,
};
use objc2_core_image::CIImage;
use objc2_core_media::kCMTimeZero;
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSString, NSURL};
use serde::Deserialize;
use ts_rs::TS;

/// Everything the export draws, in pixels of the exported video, measured from its top left.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportLayout {
    /// The whole picture. Both are even, as H.264 needs.
    width: u32,
    height: u32,
    /// Where the recording sits.
    recording: PixelRect,
    /// The recording's corner radius.
    radius: f64,
    shadow: ExportShadow,
    background: ExportGradient,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct PixelRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// A shadow like CSS's `box-shadow: 0 <offsetY> <blur> rgb(0 0 0 / <opacity>)`.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportShadow {
    offset_y: f64,
    blur: f64,
    opacity: f64,
}

/// A gradient like CSS's `linear-gradient(<angle>deg, <stops>)`.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportGradient {
    /// In degrees, as CSS measures them: 0 points up, 90 points right.
    angle: f64,
    stops: Vec<ExportStop>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportStop {
    /// Like "#2a9d8f".
    color: String,
    /// From 0 to 1 along the gradient.
    at: f64,
}

/// Writes `video` to `output` in `layout`, calling `progress` with 0 to 1 as it goes. Blocks until
/// the file is done.
pub(crate) fn export(
    video: &Path,
    output: &Path,
    layout: &ExportLayout,
    progress: impl Fn(f32),
) -> Result<()> {
    let cutout = cutout(layout)?;
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let video_type = unsafe { AVMediaTypeVideo }.context("AVFoundation has no video type")?;
    // The newer form loads tracks through a callback; for a file on disk this is just as quick.
    #[allow(deprecated)]
    let track = unsafe { asset.tracksWithMediaType(video_type) }
        .firstObject()
        .context("the recording has no video")?;
    let place = placement(&layout.recording, layout.height, unsafe {
        track.naturalSize()
    });
    let picture = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(layout.width.into(), layout.height.into()),
    );

    // Runs for every frame, on AVFoundation's threads: the frame moved into place, under the cut-out.
    let draw_frame = RcBlock::new(
        move |request: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            let request = unsafe { request.as_ref() };
            unsafe {
                let frame = request.sourceImage().imageByApplyingTransform(place);
                let image = cutout
                    .imageByCompositingOverImage(&frame)
                    .imageByCroppingToRect(picture);
                request.finishWithImage_context(&image, None);
            }
        },
    );
    // The newer form only reports the composition through a callback; this one returns it.
    #[allow(deprecated)]
    let composition = unsafe {
        AVMutableVideoComposition::videoCompositionWithAsset_applyingCIFiltersWithHandler(
            &asset,
            &draw_frame,
        )
    };
    unsafe { composition.setRenderSize(picture.size) };

    let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(&asset) }.map_err(|error| {
        anyhow::anyhow!("could not read the recording: {}", reason(Some(error)))
    })?;
    let tracks = NSArray::from_retained_slice(&[track]);
    let frames = unsafe {
        AVAssetReaderVideoCompositionOutput::assetReaderVideoCompositionOutputWithVideoTracks_videoSettings(&tracks, None)
    };
    unsafe {
        frames.setVideoComposition(Some(&composition));
        reader.addOutput(&frames);
    }

    let mp4 = unsafe { AVFileTypeMPEG4 }.context("AVFoundation has no MP4 type")?;
    let writer =
        unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&file_url(output), mp4) }
            .map_err(|error| {
                anyhow::anyhow!("could not start the file: {}", reason(Some(error)))
            })?;
    let settings = h264(layout.width, layout.height)?;
    let input = unsafe {
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            video_type,
            Some(&settings),
        )
    };
    unsafe {
        input.setExpectsMediaDataInRealTime(false);
        writer.addInput(&input);
    }

    ensure!(
        unsafe { reader.startReading() },
        "could not read the recording: {}",
        reason(unsafe { reader.error() })
    );
    ensure!(
        unsafe { writer.startWriting() },
        "could not start the file: {}",
        reason(unsafe { writer.error() })
    );
    unsafe { writer.startSessionAtSourceTime(kCMTimeZero) };
    let duration = unsafe { asset.duration().seconds() };
    // Reported in steps of at least 1%, so a long recording doesn't send an event every frame.
    let mut reported = 0.0;
    while let Some(frame) = unsafe { frames.copyNextSampleBuffer() } {
        // The encoder takes frames as fast as it can; wait whenever it has a backlog.
        while !unsafe { input.isReadyForMoreMediaData() } {
            std::thread::sleep(Duration::from_millis(2));
        }
        ensure!(
            unsafe { input.appendSampleBuffer(&frame) },
            "could not write a frame: {}",
            reason(unsafe { writer.error() })
        );
        let done = unsafe { frame.presentation_time_stamp().seconds() } / duration;
        if duration > 0.0 && done - reported >= 0.01 {
            reported = done;
            progress(done as f32);
        }
    }
    ensure!(
        unsafe { reader.status() } == AVAssetReaderStatus::Completed,
        "could not read the recording to the end: {}",
        reason(unsafe { reader.error() })
    );

    unsafe { input.markAsFinished() };
    let (finished, wait) = mpsc::channel();
    let on_finish = RcBlock::new(move || {
        let _ = finished.send(());
    });
    unsafe { writer.finishWritingWithCompletionHandler(&on_finish) };
    let _ = wait.recv();
    ensure!(
        unsafe { writer.status() } == AVAssetWriterStatus::Completed,
        "could not finish the file: {}",
        reason(unsafe { writer.error() })
    );
    Ok(())
}

/// H.264 at `width` × `height`: 8 bits per pixel per second, like the recorder's own files, with a
/// keyframe at least every second so the export scrubs quickly too.
fn h264(width: u32, height: u32) -> Result<Retained<NSDictionary<NSString, AnyObject>>> {
    let key =
        |key: Option<&'static NSString>| key.context("AVFoundation is missing a video setting");
    let bitrate = NSNumber::new_u64(u64::from(width) * u64::from(height) * 8);
    let keyframe_every = NSNumber::new_f64(1.0);
    let compression = NSDictionary::<NSString, NSNumber>::from_slices(
        &[
            key(unsafe { AVVideoAverageBitRateKey })?,
            key(unsafe { AVVideoMaxKeyFrameIntervalDurationKey })?,
        ],
        &[&bitrate, &keyframe_every],
    );
    let codec = key(unsafe { AVVideoCodecTypeH264 })?;
    let (width, height) = (NSNumber::new_u32(width), NSNumber::new_u32(height));
    let values: [&AnyObject; 4] = [
        codec.as_ref(),
        width.as_ref(),
        height.as_ref(),
        compression.as_ref(),
    ];
    Ok(NSDictionary::from_slices(
        &[
            key(unsafe { AVVideoCodecKey })?,
            key(unsafe { AVVideoWidthKey })?,
            key(unsafe { AVVideoHeightKey })?,
            key(unsafe { AVVideoCompressionPropertiesKey })?,
        ],
        &values,
    ))
}

fn reason(error: Option<Retained<NSError>>) -> String {
    error.map_or_else(
        || "macOS didn't say why".into(),
        |error| error.localizedDescription().to_string(),
    )
}

/// The look without the recording: the background and the recording's shadow, with a rounded
/// hole where the recording goes. Core Graphics counts up from the bottom, so rectangles flip.
fn cutout(layout: &ExportLayout) -> Result<Retained<CIImage>> {
    let (width, height) = (layout.width as usize, layout.height as usize);
    let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
        .context("macOS has no sRGB colour space")?;
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
    .context("could not make a picture to draw the look in")?;
    let context = Some(&*context);

    let gradient = gradient(&srgb, &layout.background)?;
    let (start, end) = gradient_line(layout.background.angle, width as f64, height as f64);
    let extend = CGGradientDrawingOptions::DrawsBeforeStartLocation
        | CGGradientDrawingOptions::DrawsAfterEndLocation;
    CGContext::draw_linear_gradient(context, Some(&gradient), start, end, extend);

    let hole = rounded_rect(&layout.recording, layout.radius, layout.height);
    // The shadow comes from filling the hole's shape, which the next step clears again.
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

    let image = CGBitmapContextCreateImage(context).context("could not finish the look")?;
    Ok(unsafe { CIImage::imageWithCGImage(&image) })
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

/// Where a CSS `linear-gradient(<angle>deg, …)` starts and ends on a `width` × `height` picture, in
/// Core Graphics' coordinates. CSS runs the line through the centre, just long enough to reach the
/// corners.
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

/// Moves and scales a video frame of `natural` size onto `rect`, in a picture `height` tall.
fn placement(rect: &PixelRect, height: u32, natural: CGSize) -> CGAffineTransform {
    CGAffineTransform {
        a: rect.width / natural.width,
        b: 0.0,
        c: 0.0,
        d: rect.height / natural.height,
        tx: rect.x,
        ty: f64::from(height) - rect.y - rect.height,
    }
}

fn rounded_rect(rect: &PixelRect, radius: f64, height: u32) -> CFRetained<CGPath> {
    let flipped = CGRect::new(
        CGPoint::new(rect.x, f64::from(height) - rect.y - rect.height),
        CGSize::new(rect.width, rect.height),
    );
    unsafe { CGPath::with_rounded_rect(flipped, radius, radius, std::ptr::null()) }
}

/// "#2a9d8f" as red, green and blue from 0 to 1.
fn rgb(hex: &str) -> Result<[f64; 3]> {
    let digits = hex.strip_prefix('#').filter(|digits| digits.len() == 6);
    let digits = digits.with_context(|| format!("{hex:?} isn't a colour like #2a9d8f"))?;
    let channel = |at: usize| -> Result<f64> {
        Ok(f64::from(u8::from_str_radix(&digits[at..at + 2], 16)?) / 255.0)
    };
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: CGPoint, x: f64, y: f64) -> bool {
        (a.x - x).abs() < 1e-9 && (a.y - y).abs() < 1e-9
    }

    #[test]
    fn gradient_lines_run_the_way_css_draws_them() {
        // 90deg runs left to right, through the middle.
        let (start, end) = gradient_line(90.0, 100.0, 50.0);
        assert!(close(start, 0.0, 25.0) && close(end, 100.0, 25.0));
        // 180deg runs top to bottom, and Core Graphics' top is the larger y.
        let (start, end) = gradient_line(180.0, 100.0, 50.0);
        assert!(close(start, 50.0, 50.0) && close(end, 50.0, 0.0));
        // 135deg on a square runs from the top-left corner to the bottom-right one.
        let (start, end) = gradient_line(135.0, 100.0, 100.0);
        assert!(close(start, 0.0, 100.0) && close(end, 100.0, 0.0));
    }

    #[test]
    fn placement_moves_the_frame_onto_its_rectangle_from_the_bottom() {
        let rect = PixelRect {
            x: 10.0,
            y: 20.0,
            width: 200.0,
            height: 100.0,
        };
        let place = placement(&rect, 300, CGSize::new(400.0, 200.0));
        assert_eq!((place.a, place.d), (0.5, 0.5));
        assert_eq!((place.tx, place.ty), (10.0, 180.0));
    }

    #[test]
    fn colours_read_from_hex_and_bad_ones_say_why() {
        assert_eq!(rgb("#ff0000").unwrap(), [1.0, 0.0, 0.0]);
        assert!(rgb("2a9d8f").is_err());
        assert!(rgb("#2a9d8").is_err());
    }

    /// Exports a real recording, so it's skipped unless asked for:
    /// `EXPORT_TEST_VIDEO=<video> EXPORT_TEST_OUTPUT=<new .mp4> cargo test -- --ignored`
    /// The layout is the default look's at the video's full size, the way the page works it out.
    #[test]
    #[ignore = "needs a real video"]
    fn exports_a_recording_in_the_default_look() {
        let video = std::env::var("EXPORT_TEST_VIDEO").expect("EXPORT_TEST_VIDEO");
        let output = std::env::var("EXPORT_TEST_OUTPUT").expect("EXPORT_TEST_OUTPUT");
        let (video_width, video_height): (f64, f64) = (
            std::env::var("EXPORT_TEST_WIDTH").unwrap().parse().unwrap(),
            std::env::var("EXPORT_TEST_HEIGHT")
                .unwrap()
                .parse()
                .unwrap(),
        );
        let ratio = video_width / video_height;
        let even = |value: f64| ((value / 2.0).round() * 2.0) as u32;
        let width = even(video_width / (1.0 - 2.0 * 64.0 / 1920.0 * ratio.max(1.0)));
        let height = even(f64::from(width) / ratio);
        let scale = f64::from(width) / 1920.0;
        let layout = ExportLayout {
            width,
            height,
            recording: PixelRect {
                x: ((f64::from(width) - video_width) / 2.0).round(),
                y: ((f64::from(height) - video_height) / 2.0).round(),
                width: video_width,
                height: video_height,
            },
            radius: 20.0 * scale,
            shadow: ExportShadow {
                offset_y: 16.0 * scale,
                blur: 48.0 * scale,
                opacity: 0.4,
            },
            background: ExportGradient {
                angle: 135.0,
                stops: vec![
                    ExportStop {
                        color: "#0f4c5c".into(),
                        at: 0.0,
                    },
                    ExportStop {
                        color: "#2a9d8f".into(),
                        at: 0.55,
                    },
                    ExportStop {
                        color: "#e9c46a".into(),
                        at: 1.0,
                    },
                ],
            },
        };
        export(Path::new(&video), Path::new(&output), &layout, |_| {}).unwrap();
        assert!(Path::new(&output).exists());
    }
}
