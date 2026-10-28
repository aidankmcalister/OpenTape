use std::path::Path;
use std::ptr::NonNull;

use anyhow::{Context, Result, ensure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAsset, AVAssetReader, AVAssetReaderAudioMixOutput, AVAssetReaderStatus,
    AVAssetReaderTrackOutput, AVAssetReaderVideoCompositionOutput, AVAssetTrack,
    AVAsynchronousCIImageFilteringRequest, AVAudioTimePitchAlgorithmVarispeed, AVMediaTypeAudio,
    AVMediaTypeVideo, AVMutableComposition, AVMutableVideoComposition, AVURLAsset,
};
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMFormatDescription, CMTime, CMTimeRange,
    kCMTimeZero,
};
use objc2_foundation::{NSArray, NSError, NSString, NSURL};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod cursor;
mod cutout;
mod rings;
pub(crate) mod typing;
mod writers;

pub(crate) use cursor::ExportCursor;
use cutout::cutout;
pub(crate) use rings::ExportRing;
use rings::RingPictures;
use writers::{compression, write_gif, write_mp4};

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
    background_image: Option<String>,
    zoom: Vec<ExportZoom>,
    zoom_rate: f64,
    speed: Vec<ExportSpeed>,
    cuts: Vec<ExportCut>,
    blurs: Vec<ExportBlur>,
    rings: Vec<ExportRing>,
    cursor: Option<ExportCursor>,
    muted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum SoundTrack {
    Microphone,
    SystemAudio,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportCut {
    start: f64,
    end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportBlur {
    start: f64,
    end: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

impl ExportBlur {
    fn area(&self, video: &PixelRect, height: u32) -> CGRect {
        CGRect::new(
            CGPoint::new(
                video.x + self.x * video.width,
                f64::from(height) - video.y - (self.y + self.height) * video.height,
            ),
            CGSize::new(self.width * video.width, self.height * video.height),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportSpeed {
    start: f64,
    end: f64,
    amount: f64,
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
    let background = (layout.background_image.as_deref())
        .and_then(|name| Path::new(name).file_name())
        .map(|name| video.with_file_name(name));
    let cutout = cutout(layout, background.as_deref())?;
    let recording_asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let asset = retimed(&recording_asset, &layout.speed, &layout.cuts)?;
    let (track, reader) = open(&asset)?;
    let natural = unsafe { track.naturalSize() };
    let pictures = (layout.cursor.as_ref())
        .map(ExportCursor::pictures)
        .transpose()?;
    let ring_pictures = RingPictures::default();
    let mut scene = layout.clone();
    scene.cuts.sort_by(|a, b| a.start.total_cmp(&b.start));
    let picture = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(layout.width.into(), layout.height.into()),
    );

    let draw_frame = RcBlock::new(
        move |request: NonNull<AVAsynchronousCIImageFilteringRequest>| {
            let request = unsafe { request.as_ref() };
            unsafe {
                let now = uncut(&scene.cuts, request.compositionTime().seconds());
                let zoom = zoom_at(&scene.zoom, scene.zoom_rate, now);
                let video = zoomed(&scene.video, &scene.recording, zoom);
                let place = placement(&video, scene.height, natural);
                let mut frame = request.sourceImage().imageByApplyingTransform(place);
                for blur in scene
                    .blurs
                    .iter()
                    .filter(|blur| (blur.start..blur.end).contains(&now))
                {
                    frame = frame
                        .imageByClampingToExtent()
                        .imageByApplyingGaussianBlurWithSigma(blur.radius * zoom.scale)
                        .imageByCroppingToRect(blur.area(&video, scene.height))
                        .imageByCompositingOverImage(&frame);
                }
                for ring in scene.rings.iter().filter(|ring| ring.is_showing(now)) {
                    if let Ok(image) =
                        ring.image(now, &video, zoom.scale, scene.height, &ring_pictures)
                    {
                        frame = image.imageByCompositingOverImage(&frame);
                    }
                }
                let mut image = cutout.imageByCompositingOverImage(&frame);
                if let Some(Ok(Some(drawn))) = scene
                    .cursor
                    .as_ref()
                    .zip(pictures.as_ref())
                    .map(|(cursor, pictures)| cursor.image(now, &video, scene.height, pictures))
                {
                    image = drawn.imageByCompositingOverImage(&image);
                }
                let image = image.imageByCroppingToRect(picture);
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

    let tracks = NSArray::from_retained_slice(&[track]);
    let frames = unsafe {
        AVAssetReaderVideoCompositionOutput::assetReaderVideoCompositionOutputWithVideoTracks_videoSettings(&tracks, None)
    };
    unsafe {
        frames.setVideoComposition(Some(&composition));
        reader.addOutput(&frames);
    }
    let sound = match options.format {
        ExportFormat::Mp4 if !layout.muted => mixed_sound(&asset, &reader)?,
        _ => None,
    };
    let duration = unsafe { asset.duration().seconds() };
    let reported = std::cell::Cell::new(0.0);
    let progress_at = |time: CMTime| {
        let done = unsafe { time.seconds() } / duration;
        if duration > 0.0 && done - reported.get() >= 0.01 {
            reported.set(done);
            progress(done as f32);
        }
    };
    read_all(&reader, || match options.format {
        ExportFormat::Mp4 => {
            let settings = compression(layout.width, layout.height, options.bits_per_pixel)?;
            write_mp4(
                &frames,
                sound.as_deref(),
                output,
                Some(&settings),
                None,
                progress_at,
            )
        }
        ExportFormat::Gif => write_gif(&frames, output, options.frame_rate, duration, progress_at),
    })
}

pub(crate) fn to_mp4(video: &Path, output: &Path) -> Result<()> {
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let (track, reader) = open(&asset)?;
    let frames = unsafe {
        AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, None)
    };
    unsafe { reader.addOutput(&frames) };
    let sound = mixed_sound(&asset, &reader)?;
    let format = unsafe { track.formatDescriptions() }.firstObject();
    let hint =
        format.map(|format| unsafe { &*Retained::as_ptr(&format).cast::<CMFormatDescription>() });
    read_all(&reader, || {
        write_mp4(&frames, sound.as_deref(), output, None, hint, |_| {})
    })
}

fn open(asset: &AVAsset) -> Result<(Retained<AVAssetTrack>, Retained<AVAssetReader>)> {
    let video_type = unsafe { AVMediaTypeVideo }.context("AVFoundation has no video type")?;
    #[allow(deprecated)]
    let track = unsafe { asset.tracksWithMediaType(video_type) }
        .firstObject()
        .context("the recording has no video")?;
    let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(asset) }.map_err(|error| {
        anyhow::anyhow!("could not read the recording: {}", reason(Some(error)))
    })?;
    Ok((track, reader))
}

fn read_all(reader: &AVAssetReader, write: impl FnOnce() -> Result<()>) -> Result<()> {
    ensure!(
        unsafe { reader.startReading() },
        "could not read the recording: {}",
        reason(unsafe { reader.error() })
    );
    write()?;
    ensure!(
        unsafe { reader.status() } == AVAssetReaderStatus::Completed,
        "could not read the recording to the end: {}",
        reason(unsafe { reader.error() })
    );
    Ok(())
}

pub(crate) fn sound_tracks(video: &Path) -> Result<Vec<SoundTrack>> {
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    Ok(audio_tracks(&asset)?
        .iter()
        .map(|track| sound_track(&track))
        .collect())
}

fn audio_tracks(asset: &AVAsset) -> Result<Retained<NSArray<AVAssetTrack>>> {
    let audio_type = unsafe { AVMediaTypeAudio }.context("AVFoundation has no audio type")?;
    #[allow(deprecated)]
    Ok(unsafe { asset.tracksWithMediaType(audio_type) })
}

fn sound_track(track: &AVAssetTrack) -> SoundTrack {
    let channels = unsafe { track.formatDescriptions() }
        .firstObject()
        .and_then(|format| unsafe {
            let format = &*Retained::as_ptr(&format).cast::<CMFormatDescription>();
            CMAudioFormatDescriptionGetStreamBasicDescription(format).as_ref()
        })
        .map_or(0, |basics| basics.mChannelsPerFrame);
    if channels == 1 {
        SoundTrack::Microphone
    } else {
        SoundTrack::SystemAudio
    }
}

fn mixed_sound(
    asset: &AVAsset,
    reader: &AVAssetReader,
) -> Result<Option<Retained<AVAssetReaderAudioMixOutput>>> {
    let tracks = audio_tracks(asset)?;
    if tracks.is_empty() {
        return Ok(None);
    }
    let output = unsafe {
        AVAssetReaderAudioMixOutput::assetReaderAudioMixOutputWithAudioTracks_audioSettings(
            &tracks, None,
        )
    };
    unsafe {
        if let Some(varispeed) = AVAudioTimePitchAlgorithmVarispeed {
            output.setAudioTimePitchAlgorithm(varispeed);
        }
        reader.addOutput(&output);
    }
    Ok(Some(output))
}

fn retimed(
    asset: &AVURLAsset,
    speed: &[ExportSpeed],
    cuts: &[ExportCut],
) -> Result<Retained<AVMutableComposition>> {
    let composition = unsafe { AVMutableComposition::composition() };
    let whole = unsafe { CMTimeRange::new(kCMTimeZero, asset.duration()) };
    #[allow(deprecated)]
    unsafe { composition.insertTimeRange_ofAsset_atTime_error(whole, asset, kCMTimeZero) }
        .map_err(|error| {
            anyhow::anyhow!("could not read the recording: {}", reason(Some(error)))
        })?;
    for span in latest_first(speed, |span| span.start) {
        let length = span.end - span.start;
        let range = unsafe { CMTimeRange::new(seconds(span.start), seconds(length)) };
        unsafe { composition.scaleTimeRange_toDuration(range, seconds(length / span.amount)) };
    }
    for cut in latest_first(cuts, |cut| cut.start) {
        let range = unsafe { CMTimeRange::new(seconds(cut.start), seconds(cut.end - cut.start)) };
        unsafe { composition.removeTimeRange(range) };
    }
    Ok(composition)
}

fn latest_first<T: Copy>(spans: &[T], start: fn(&T) -> f64) -> Vec<T> {
    let mut spans = spans.to_vec();
    spans.sort_by(|a, b| start(b).total_cmp(&start(a)));
    spans
}

fn uncut(earliest_first: &[ExportCut], seconds: f64) -> f64 {
    earliest_first.iter().fold(seconds, |at, cut| {
        if at >= cut.start {
            at + cut.end - cut.start
        } else {
            at
        }
    })
}

fn seconds(value: f64) -> CMTime {
    unsafe { CMTime::with_seconds(value, 600) }
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

fn zoom_at(zoom: &[ExportZoom], rate: f64, seconds: f64) -> ExportZoom {
    let step = (seconds * rate).round().max(0.0) as usize;
    zoom.get(step).or(zoom.last()).copied().unwrap_or(NO_ZOOM)
}

fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

#[cfg(test)]
mod tests;
