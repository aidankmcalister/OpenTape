use std::path::Path;
use std::ptr::NonNull;

use anyhow::{Context, Result, ensure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderStatus, AVAssetReaderVideoCompositionOutput,
    AVAsynchronousCIImageFilteringRequest, AVMediaTypeVideo, AVMutableVideoComposition, AVURLAsset,
};
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_media::CMTime;
use objc2_foundation::{NSArray, NSError, NSString, NSURL};
use serde::Deserialize;
use ts_rs::TS;

mod cutout;
mod writers;

use cutout::cutout;
use writers::{write_gif, write_mp4};

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportLayout {
    width: u32,
    height: u32,
    recording: PixelRect,
    video: PixelRect,
    radius: f64,
    shadow: ExportShadow,
    border: Option<ExportBorder>,
    background: ExportGradient,
    zoom: Vec<ExportZoom>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportZoom {
    scale: f64,
    x: f64,
    y: f64,
}

const NO_ZOOM: ExportZoom = ExportZoom {
    scale: 1.0,
    x: 0.5,
    y: 0.5,
};

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportBorder {
    width: f64,
    color: String,
    opacity: f64,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportOptions {
    format: ExportFormat,
    frame_rate: u32,
    bits_per_pixel: f64,
    pub(crate) to_clipboard: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum ExportFormat {
    Mp4,
    Gif,
}

impl ExportOptions {
    pub(crate) fn extension(&self) -> &'static str {
        match self.format {
            ExportFormat::Mp4 => "mp4",
            ExportFormat::Gif => "gif",
        }
    }
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct PixelRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportShadow {
    offset_y: f64,
    blur: f64,
    opacity: f64,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportGradient {
    angle: f64,
    stops: Vec<ExportStop>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportStop {
    color: String,
    at: f64,
}

pub(crate) fn export(
    video: &Path,
    output: &Path,
    layout: &ExportLayout,
    options: &ExportOptions,
    progress: impl Fn(f32),
) -> Result<()> {
    let cutout = cutout(layout)?;
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let video_type = unsafe { AVMediaTypeVideo }.context("AVFoundation has no video type")?;
    #[allow(deprecated)]
    let track = unsafe { asset.tracksWithMediaType(video_type) }
        .firstObject()
        .context("the recording has no video")?;
    let natural = unsafe { track.naturalSize() };
    let (recording, video_rect, height, zoom) = (
        layout.recording.clone(),
        layout.video.clone(),
        layout.height,
        layout.zoom.clone(),
    );
    let picture = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(layout.width.into(), layout.height.into()),
    );

    let draw_frame = RcBlock::new(
        move |request: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            let request = unsafe { request.as_ref() };
            unsafe {
                let zoom = zoom_at(&zoom, request.compositionTime().seconds());
                let place = placement(&zoomed(&video_rect, &recording, zoom), height, natural);
                let frame = request.sourceImage().imageByApplyingTransform(place);
                let image = cutout
                    .imageByCompositingOverImage(&frame)
                    .imageByCroppingToRect(picture);
                request.finishWithImage_context(&image, None);
            }
        },
    );
    #[allow(deprecated)]
    let composition = unsafe {
        AVMutableVideoComposition::videoCompositionWithAsset_applyingCIFiltersWithHandler(
            &asset,
            &draw_frame,
        )
    };
    unsafe {
        composition.setRenderSize(picture.size);
        composition.setSourceTrackIDForFrameTiming(0);
        composition.setFrameDuration(CMTime::new(1, options.frame_rate as i32));
    }

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

    ensure!(
        unsafe { reader.startReading() },
        "could not read the recording: {}",
        reason(unsafe { reader.error() })
    );
    let duration = unsafe { asset.duration().seconds() };
    let reported = std::cell::Cell::new(0.0);
    let progress_at = |time: CMTime| {
        let done = unsafe { time.seconds() } / duration;
        if duration > 0.0 && done - reported.get() >= 0.01 {
            reported.set(done);
            progress(done as f32);
        }
    };
    match options.format {
        ExportFormat::Mp4 => write_mp4(&frames, output, layout, options, progress_at)?,
        ExportFormat::Gif => write_gif(&frames, output, options.frame_rate, duration, progress_at)?,
    }
    ensure!(
        unsafe { reader.status() } == AVAssetReaderStatus::Completed,
        "could not read the recording to the end: {}",
        reason(unsafe { reader.error() })
    );
    Ok(())
}

fn reason(error: Option<Retained<NSError>>) -> String {
    error.map_or_else(
        || "macOS didn't say why".into(),
        |error| error.localizedDescription().to_string(),
    )
}

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

fn zoomed(rect: &PixelRect, frame: &PixelRect, zoom: ExportZoom) -> PixelRect {
    let focus_x = frame.x + frame.width * zoom.x;
    let focus_y = frame.y + frame.height * zoom.y;
    PixelRect {
        x: focus_x - (focus_x - rect.x) * zoom.scale,
        y: focus_y - (focus_y - rect.y) * zoom.scale,
        width: rect.width * zoom.scale,
        height: rect.height * zoom.scale,
    }
}

fn zoom_at(zoom: &[ExportZoom], seconds: f64) -> ExportZoom {
    let step = (seconds * 60.0).round().max(0.0) as usize;
    zoom.get(step).or(zoom.last()).copied().unwrap_or(NO_ZOOM)
}

fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

#[cfg(test)]
mod tests;
