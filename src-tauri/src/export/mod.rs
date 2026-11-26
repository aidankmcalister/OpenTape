use std::path::Path;

use anyhow::{Context, Result, ensure};
use base64::Engine;
use objc2::rc::Retained;
use objc2_av_foundation::{
    AVAsset, AVAssetReader, AVAssetReaderAudioMixOutput, AVAssetReaderStatus,
    AVAssetReaderVideoCompositionOutput, AVAssetTrack, AVAudioTimePitchAlgorithmVarispeed,
    AVMediaTypeAudio, AVMediaTypeVideo, AVMutableAudioMix, AVMutableAudioMixInputParameters,
    AVMutableComposition, AVMutableVideoComposition, AVURLAsset,
};
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGBitmapContextCreateImage, CGContext, CGImage};
use objc2_core_image::{CIContext, CIImage};
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMFormatDescription, CMTime, CMTimeRange,
    kCMTimeZero,
};
use objc2_foundation::{NSArray, NSData, NSError, NSString, NSURL};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod compositor;
mod cursor;
mod cutout;
mod rings;
pub(crate) mod typing;
mod writers;

pub(crate) use cursor::ExportCursor;
use cutout::{canvas, cutout, moved};
pub(crate) use rings::ExportRing;
use rings::RingPictures;
use writers::{compression, write_gif, write_mp4};

/// What an export stops with when it is canceled before the end.
#[derive(Debug)]
pub(crate) struct Canceled;

impl std::fmt::Display for Canceled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the export was canceled")
    }
}

impl std::error::Error for Canceled {}

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
    badges: Vec<ExportBadge>,
    cursor: Option<ExportCursor>,
    sound: ExportSound,
}

/// How loud each track plays in the export, from 0 (muted) to 1 (as recorded).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportSound {
    system_audio: f32,
    microphone: f32,
}

impl ExportSound {
    fn volume(&self, track: SoundTrack) -> f32 {
        match track {
            SoundTrack::SystemAudio => self.system_audio,
            SoundTrack::Microphone => self.microphone,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
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

/// A key badge, drawn by the editor as a PNG and placed from its top-left corner in pixels.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportBadge {
    start: f64,
    end: f64,
    x: f64,
    y: f64,
    png: String,
}

/// Matches BADGE_FADE_MS in keys.ts.
const BADGE_FADE_SECONDS: f64 = 0.1;
const BADGE_FADE_STEPS: usize = 10;

impl ExportBadge {
    /// The badge at each fade step, faintest first, placed in the frame.
    fn pictures(&self, height: u32) -> Result<Vec<Retained<CIImage>>> {
        let png = base64::engine::general_purpose::STANDARD.decode(&self.png)?;
        let source = unsafe { CIImage::imageWithData(&NSData::with_bytes(&png)) }
            .context("could not read a key badge")?;
        let drawn =
            unsafe { CIContext::context().createCGImage_fromRect(&source, source.extent()) }
                .context("could not draw a key badge")?;
        let (width, tall) = (CGImage::width(Some(&drawn)), CGImage::height(Some(&drawn)));
        let whole = CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(width as f64, tall as f64),
        );
        let top = f64::from(height) - self.y - tall as f64;
        (1..=BADGE_FADE_STEPS)
            .map(|step| {
                let (_, context) = canvas(width, tall, None)?;
                let context = Some(&*context);
                CGContext::set_alpha(context, step as f64 / BADGE_FADE_STEPS as f64);
                CGContext::draw_image(context, whole, Some(&drawn));
                let faded =
                    CGBitmapContextCreateImage(context).context("could not fade a key badge")?;
                Ok(moved(
                    &*unsafe { CIImage::imageWithCGImage(&faded) },
                    self.x,
                    top,
                ))
            })
            .collect()
    }

    /// Which fade step shows at `now`, if any: it fades in at the start and out at the end.
    fn step(&self, now: f64) -> Option<usize> {
        let alpha = ((now - self.start).min(self.end - now) / BADGE_FADE_SECONDS).min(1.0);
        (alpha > 0.0).then(|| ((alpha * BADGE_FADE_STEPS as f64).ceil() as usize).max(1) - 1)
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
    /// 0 to 1, for MP4: how close every frame stays to the original.
    quality: f64,
    pub(crate) to_clipboard: bool,
    pub(crate) name: Option<String>,
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
    is_canceled: impl Fn() -> bool,
) -> Result<()> {
    let background = (layout.background_image.as_deref())
        .and_then(|name| Path::new(name).file_name())
        .map(|name| video.with_file_name(name));
    let cutout = cutout(layout, background.as_deref())?;
    let recording_asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let end = crate::stage::readable_end(video)?;
    let asset = retimed(&recording_asset, end, &layout.speed, &layout.cuts)?;
    let (track, reader) = open(&asset)?;
    let natural = unsafe { track.naturalSize() };
    let pictures = (layout.cursor.as_ref())
        .map(ExportCursor::pictures)
        .transpose()?;
    let ring_pictures = RingPictures::default();
    let badges = (layout.badges.iter())
        .map(|badge| Ok((badge.clone(), badge.pictures(layout.height)?)))
        .collect::<Result<Vec<_>>>()?;
    let mut scene = layout.clone();
    scene.cuts.sort_by(|a, b| a.start.total_cmp(&b.start));
    let picture = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(layout.width.into(), layout.height.into()),
    );

    let draw = move |seconds: f64, source: &CIImage| unsafe {
        let now = uncut(&scene.cuts, seconds);
        let zoom = zoom_at(&scene.zoom, scene.zoom_rate, now);
        let video = zoomed(&scene.video, &scene.recording, zoom);
        let place = placement(&video, scene.height, natural);
        let mut frame = source.imageByApplyingTransform(place);
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
            if let Ok(image) = ring.image(now, &video, zoom.scale, scene.height, &ring_pictures) {
                frame = image.imageByCompositingOverImage(&frame);
            }
        }
        let mut image = cutout.imageByCompositingOverImage(&frame);
        for (badge, pictures) in &badges {
            if let Some(step) = badge.step(now) {
                image = pictures[step].imageByCompositingOverImage(&image);
            }
        }
        if let Some(Ok(Some(drawn))) = scene
            .cursor
            .as_ref()
            .zip(pictures.as_ref())
            .map(|(cursor, pictures)| cursor.image(now, &video, scene.height, pictures))
        {
            image = drawn.imageByCompositingOverImage(&image);
        }
        image.imageByCroppingToRect(picture)
    };
    // GIF times frames in hundredths of a second, and browsers slow down
    // frames shorter than 0.02 s, so a GIF never goes past 50 fps.
    let frame_rate = match options.format {
        ExportFormat::Mp4 => options.frame_rate,
        ExportFormat::Gif => options.frame_rate.min(50),
    };
    #[allow(deprecated)]
    let composition =
        unsafe { AVMutableVideoComposition::videoCompositionWithPropertiesOfAsset(&asset) };
    let whole = CMTimeRange {
        start: unsafe { kCMTimeZero },
        duration: unsafe { asset.duration() },
    };
    let _turn = compositor::use_compositor(&composition, &track, whole, Box::new(draw));
    unsafe {
        composition.setRenderSize(picture.size);
        composition.setSourceTrackIDForFrameTiming(0);
        composition.setFrameDuration(CMTime::new(1, frame_rate as i32));
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
        ExportFormat::Mp4 => mixed_sound(&asset, &reader, layout.sound)?,
        _ => None,
    };
    let duration = unsafe { asset.duration().seconds() };
    let reported = std::cell::Cell::new(0.0);
    let progress_at = |time: CMTime| {
        ensure!(!is_canceled(), Canceled);
        let done = unsafe { time.seconds() } / duration;
        if duration > 0.0 && done - reported.get() >= 0.01 {
            reported.set(done);
            progress(done as f32);
        }
        Ok(())
    };
    read_all(&reader, || match options.format {
        ExportFormat::Mp4 => {
            let settings = compression(layout.width, layout.height, options.quality)?;
            write_mp4(&frames, sound.as_deref(), output, &settings, progress_at)
        }
        ExportFormat::Gif => write_gif(
            &frames,
            output,
            (layout.width, layout.height),
            frame_rate,
            progress_at,
        ),
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

pub(crate) fn read_all(reader: &AVAssetReader, write: impl FnOnce() -> Result<()>) -> Result<()> {
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

pub(crate) fn audio_tracks(asset: &AVAsset) -> Result<Retained<NSArray<AVAssetTrack>>> {
    let audio_type = unsafe { AVMediaTypeAudio }.context("AVFoundation has no audio type")?;
    #[allow(deprecated)]
    Ok(unsafe { asset.tracksWithMediaType(audio_type) })
}

pub(crate) fn sound_track(track: &AVAssetTrack) -> SoundTrack {
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

/// Mixes the recording's sound tracks at their export volumes, leaving out muted ones. None
/// when nothing is heard.
fn mixed_sound(
    asset: &AVAsset,
    reader: &AVAssetReader,
    sound: ExportSound,
) -> Result<Option<Retained<AVAssetReaderAudioMixOutput>>> {
    let heard: Vec<_> = audio_tracks(asset)?
        .iter()
        .filter(|track| sound.volume(sound_track(track)) > 0.0)
        .collect();
    if heard.is_empty() {
        return Ok(None);
    }
    let volumes: Vec<_> = heard
        .iter()
        .map(|track| unsafe {
            let volume =
                AVMutableAudioMixInputParameters::audioMixInputParametersWithTrack(Some(track));
            volume.setVolume_atTime(sound.volume(sound_track(track)), kCMTimeZero);
            Retained::into_super(volume)
        })
        .collect();
    let mix = unsafe { AVMutableAudioMix::audioMix() };
    unsafe { mix.setInputParameters(&NSArray::from_retained_slice(&volumes)) };
    let output = unsafe {
        AVAssetReaderAudioMixOutput::assetReaderAudioMixOutputWithAudioTracks_audioSettings(
            &NSArray::from_retained_slice(&heard),
            None,
        )
    };
    unsafe {
        output.setAudioMix(Some(&mix));
        if let Some(varispeed) = AVAudioTimePitchAlgorithmVarispeed {
            output.setAudioTimePitchAlgorithm(varispeed);
        }
        reader.addOutput(&output);
    }
    Ok(Some(output))
}

fn retimed(
    asset: &AVURLAsset,
    end: Option<CMTime>,
    speed: &[ExportSpeed],
    cuts: &[ExportCut],
) -> Result<Retained<AVMutableComposition>> {
    let composition = unsafe { AVMutableComposition::composition() };
    let whole = unsafe { CMTimeRange::new(kCMTimeZero, end.unwrap_or(asset.duration())) };
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

pub(crate) fn seconds(value: f64) -> CMTime {
    unsafe { CMTime::with_seconds(value, 600) }
}

pub(crate) fn reason(error: Option<Retained<NSError>>) -> String {
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

pub(crate) fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

#[cfg(test)]
mod tests;
