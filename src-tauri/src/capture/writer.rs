#![expect(
    clippy::useless_transmute,
    reason = "the lint fires inside cidre's define_obj_type! macro, not in this code"
)]

use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

use anyhow::{Result, anyhow, bail};
use cidre::{
    arc, av,
    av::AssetWriterStatus as Status,
    blocks, cf, cg, cm, cv, define_obj_type, ns, objc, os,
    sc::{
        self,
        stream::{Delegate, DelegateImpl, Output, OutputImpl},
    },
};

use super::Inputs;
use super::plan::CaptureSize;
use super::timeline::Timeline;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_image::{CIContext, CIImage, kCIContextWorkingColorSpace};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSDictionary, NSNull, NSString};

use crate::util::{lock, wait};

pub(super) struct RecorderState {
    writer: arc::R<av::AssetWriter>,
    input: arc::R<av::AssetWriterInput>,
    adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
    system_audio: Option<SoundTrack>,
    microphone: Option<SoundTrack>,
    timeline: Arc<Mutex<Timeline>>,
    first_frame_time: Option<f64>,
    window: Option<WindowFramer>,
}

/// Where a recorded window was over time: `(host time, frame in screen points)` each time it
/// moved or resized, added by the capture loop and read by the writer for each frame.
pub(super) type WindowLog = Arc<Mutex<Vec<(f64, cg::Rect)>>>;

/// Crops each captured frame of the window's display to where the window was when the frame was
/// captured, so the video follows the window with no lag. The crop keeps the window's starting
/// shape: a resized window is scaled to fit, and the app's menus and other windows show where
/// they overlap it.
pub(super) struct WindowFramer {
    log: WindowLog,
    display: cg::Rect,
    /// The window's size when recording started, in points: the video's shape.
    start: cg::Size,
    /// Pixels per point in the captured frames.
    scale: f64,
    context: Retained<CIContext>,
    /// `[host time, x, y, scale]` each time the crop changed: a screen point `p` lands at
    /// `(p - (x, y)) * scale` in the video, in the points of the starting window.
    moves: Vec<[f64; 4]>,
}

impl WindowFramer {
    pub fn new(log: WindowLog, display: cg::Rect, start: cg::Size, scale: f64) -> Self {
        // No color management: frames are only moved and scaled, so pixels pass through as is.
        let options = NSDictionary::<NSString, AnyObject>::from_slices(
            &[unsafe { kCIContextWorkingColorSpace }],
            &[&*NSNull::null() as &AnyObject],
        );
        Self {
            log,
            display,
            start,
            scale,
            context: unsafe { CIContext::contextWithOptions(Some(&options)) },
            moves: Vec::new(),
        }
    }

    /// Draws the window's part of `source`, a frame shown at host time `time`, into `output`.
    fn frame(&mut self, source: &cv::ImageBuf, output: &mut cv::PixelBuf, time: f64) -> bool {
        let Some(window) = window_at(&mut lock(&self.log), time - DRAWN_BEFORE) else {
            return false;
        };
        let crop = framed(window, self.start, self.display);
        let zoom = self.start.width / crop.size.width;
        let placed = [crop.origin.x, crop.origin.y, zoom];
        if self.moves.last().is_none_or(|last| last[1..] != placed) {
            self.moves.push([time, crop.origin.x, crop.origin.y, zoom]);
        }
        // Core Image counts from the bottom left, in the captured frame's pixels.
        let (x, y) = (
            (crop.origin.x - self.display.origin.x) * self.scale,
            (crop.origin.y - self.display.origin.y) * self.scale,
        );
        let height = crop.size.height * self.scale;
        let fit = output.width() as f64 / (crop.size.width * self.scale);
        // A window that only moved is copied pixel for pixel, never resampled.
        let (fit, x, y) = if (fit - 1.0).abs() < 0.002 {
            (1.0, x.round(), y.round())
        } else {
            (fit, x, y)
        };
        let bottom = source.height() as f64 - y - height;
        // SAFETY: cidre and objc2 wrap the same CoreVideo buffers.
        let (source_buf, output_buf) = unsafe {
            (
                &*(source as *const cv::ImageBuf).cast::<CVPixelBuffer>(),
                &*(output as *const cv::PixelBuf).cast::<CVPixelBuffer>(),
            )
        };
        let image = unsafe {
            CIImage::imageWithCVPixelBuffer(source_buf).imageByApplyingTransform(
                CGAffineTransform {
                    a: fit,
                    b: 0.0,
                    c: 0.0,
                    d: fit,
                    tx: -x * fit,
                    ty: -bottom * fit,
                },
            )
        };
        let bounds = CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(output.width() as f64, output.height() as f64),
        );
        unsafe {
            self.context
                .render_toCVPixelBuffer_bounds_colorSpace(&image, output_buf, bounds, None)
        };
        source.propagate_attaches(output);
        true
    }
}

/// How long before a frame's time to look the window up. macOS moves a window once per screen
/// refresh and shows it in a later frame, and frames arrive up to 12 ms ahead of their own time.
/// Measured on a 60 Hz display with a window moving at 1200 and 2000 points a second: looking
/// 8 to 17 ms back put the crop on the window in 98% of frames or more; with no look back it was
/// a whole frame ahead in over half of them.
const DRAWN_BEFORE: f64 = 0.012;

/// Where the window was at `time`: the newest sample not after it. Drops the samples before that
/// one, which no later frame needs.
fn window_at(log: &mut Vec<(f64, cg::Rect)>, time: f64) -> Option<cg::Rect> {
    let newest = log.iter().rposition(|(at, _)| *at <= time).unwrap_or(0);
    log.drain(..newest);
    log.first().map(|&(_, rect)| rect)
}

/// The crop for a window: the window's starting shape, just big enough to hold it, centered on it
/// and kept inside the display.
fn framed(window: cg::Rect, start: cg::Size, display: cg::Rect) -> cg::Rect {
    let shape = start.width / start.height;
    let (width, height) = if window.size.width / window.size.height > shape {
        (window.size.width, window.size.width / shape)
    } else {
        (window.size.height * shape, window.size.height)
    };
    let place = |center: f64, length: f64, from: f64, room: f64| {
        if length >= room {
            from + (room - length) / 2.0
        } else {
            (center - length / 2.0).clamp(from, from + room - length)
        }
    };
    cg::Rect::new(
        place(
            window.origin.x + window.size.width / 2.0,
            width,
            display.origin.x,
            display.size.width,
        ),
        place(
            window.origin.y + window.size.height / 2.0,
            height,
            display.origin.y,
            display.size.height,
        ),
        width,
        height,
    )
}

struct SoundTrack {
    input: arc::R<av::AssetWriterInput>,
    end: cm::Time,
}

impl SoundTrack {
    fn new(writer: &mut av::AssetWriter, channels: i64) -> Result<Self> {
        let settings: arc::R<ns::Dictionary<ns::String, ns::Id>> = ns::Dictionary::with_keys_values(
            &[
                av::audio::all_formats_keys::id(),
                av::audio::all_formats_keys::sample_rate(),
                av::audio::all_formats_keys::number_of_channels(),
            ],
            &[
                ns::Number::with_u32(u32::from_be_bytes(*b"aac ")).as_ref(),
                ns::Number::with_f64(48_000.0).as_ref(),
                ns::Number::with_i64(channels).as_ref(),
            ],
        );
        let mut input = av::AssetWriterInput::with_media_type_and_output_settings(
            av::MediaType::audio(),
            Some(&settings),
        )
        .map_err(|err| anyhow!("audio settings were rejected: {err:?}"))?;
        input.set_expects_media_data_in_real_time(true);
        writer
            .add_input(&input)
            .map_err(|err| anyhow!("could not add audio input: {err:?}"))?;
        Ok(Self {
            input,
            end: cm::Time::zero(),
        })
    }

    /// Writes a buffer of sound, unless recording is paused. True when it was written.
    fn add(&mut self, sample_buf: &cm::SampleBuf, timeline: &Mutex<Timeline>) -> bool {
        let captured = sample_buf.pts();
        let Some(video_time) = lock(timeline).video_time(captured.as_secs()) else {
            return false;
        };
        let cut = ((captured.as_secs() - video_time) * f64::from(captured.scale)).round() as i64;
        let pts = cm::Time::new(captured.value - cut, captured.scale);
        if pts < self.end || !self.input.is_ready_for_more_media_data() {
            return true;
        }
        let Ok(timing) = sample_buf.timing_info(0) else {
            return true;
        };
        let timing = cm::SampleTimingInfo {
            pts,
            dts: cm::Time::invalid(),
            ..timing
        };
        let mut moved = None;
        let status = unsafe {
            CMSampleBufferCreateCopyWithNewTiming(None, sample_buf, 1, &timing, &mut moved)
        };
        if let Some(moved) = moved.filter(|_| status.is_ok())
            && matches!(self.input.append_sample_buf(&moved), Ok(true))
        {
            self.end = pts.add(sample_buf.duration());
        }
        true
    }
}

/// The mic's loudest sample since the record bar last asked, from 0 to 1, as `f32` bits.
static MIC_LEVEL: AtomicU32 = AtomicU32::new(0);

/// The mic's loudest sample since the last call, for the record bar's level. 0 while paused.
pub(crate) fn take_mic_level() -> f32 {
    f32::from_bits(MIC_LEVEL.swap(0, Ordering::Relaxed))
}

/// Raises the mic level to the loudest sample in a buffer of 32-bit float sound (what the mic
/// sends); any other format leaves it alone.
fn meter(sample_buf: &cm::SampleBuf) {
    let Some(format) = sample_buf
        .format_desc()
        .and_then(|desc| desc.stream_basic_desc())
    else {
        return;
    };
    if !format
        .format_flags
        .contains(cidre::cat::audio::FormatFlags::IS_FLOAT)
        || format.bits_per_channel != 32
    {
        return;
    }
    let Some(Ok(bytes)) = sample_buf.data_buf().map(|data| data.as_slice()) else {
        return;
    };
    let loudest = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|sample| f32::from_ne_bytes(*sample).abs())
        .fold(0.0, f32::max);
    // Bits of positive floats sort like the floats, so the larger bits are the louder sample.
    MIC_LEVEL.fetch_max(loudest.min(1.0).to_bits(), Ordering::Relaxed);
}

unsafe extern "C" {
    fn CMSampleBufferCreateCopyWithNewTiming(
        allocator: Option<&cf::Allocator>,
        original: &cm::SampleBuf,
        timing_count: cm::ItemCount,
        timing: &cm::SampleTimingInfo,
        copy: &mut Option<arc::R<cm::SampleBuf>>,
    ) -> os::Status;
}

impl RecorderState {
    fn add_frame(&mut self, sample_buf: &cm::SampleBuf) {
        let Some(image) = sample_buf.image_buf() else {
            return;
        };
        if self.writer.status() != Status::Writing {
            return;
        }
        let captured = sample_buf.pts();
        let mut timeline = lock(&self.timeline);
        let Some(video_time) = timeline.video_time(captured.as_secs()) else {
            return;
        };
        if !timeline.accept_frame(video_time) {
            log::warn!(
                "skipped a screen frame whose time did not move forward ({:.6} s)",
                captured.as_secs()
            );
            return;
        }
        let first_frame_time = match self.first_frame_time {
            Some(time) => time,
            None => {
                let start = timeline.session_start(video_time);
                self.writer
                    .start_session_at_src_time(cm::Time::with_secs(start, captured.scale));
                *self.first_frame_time.insert(captured.as_secs())
            }
        };
        if self.input.is_ready_for_more_media_data() {
            let pts = cm::Time::with_secs(video_time, captured.scale);
            let framed = match &mut self.window {
                Some(window) => {
                    let Some(mut output) =
                        (self.adaptor.pixel_buf_pool()).and_then(|pool| pool.pixel_buf().ok())
                    else {
                        return;
                    };
                    if !window.frame(image, &mut output, captured.as_secs()) {
                        return;
                    }
                    Some(output)
                }
                None => None,
            };
            let _ =
                (self.adaptor).append_pixel_buf_with_pts(framed.as_deref().unwrap_or(image), pts);
            if self.writer.status() == Status::Failed {
                log::warn!(
                    "the screen file failed at the frame {:.3} s in: {:#}",
                    captured.as_secs() - first_frame_time,
                    write_error(&self.writer)
                );
            }
        }
    }
}

define_obj_type!(
    pub Recorder + OutputImpl,
    RecorderState,
    RECORDER
);

impl Output for Recorder {}

#[objc::add_methods]
impl OutputImpl for Recorder {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        sample_buf: &mut cm::SampleBuf,
        kind: sc::OutputType,
    ) {
        let state = self.inner_mut();
        let sound = match kind {
            sc::OutputType::Screen => None,
            sc::OutputType::Audio => Some(&mut state.system_audio),
            sc::OutputType::Mic => Some(&mut state.microphone),
        };
        if let Some(sound) = sound {
            if let Some(track) = sound
                && state.first_frame_time.is_some()
                && track.add(sample_buf, &state.timeline)
                && kind == sc::OutputType::Mic
            {
                meter(sample_buf);
            }
            return;
        }
        state.add_frame(sample_buf);
    }
}

pub(super) type OnStop = Box<dyn Fn(String) + Send>;

define_obj_type!(pub StopWatcher + DelegateImpl, OnStop, STOP_WATCHER);

impl Delegate for StopWatcher {}

#[objc::add_methods]
impl DelegateImpl for StopWatcher {
    extern "C" fn impl_stream_did_stop_with_err(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        error: &ns::Error,
    ) {
        let reason = stop_reason(error.code(), error.localized_desc().to_string());
        self.inner()(reason);
    }
}

fn stop_reason(code: ns::Integer, description: String) -> String {
    use sc::error::code::{NO_CAPTURE_SOURCE, NO_DISPLAY_LIST, NO_WINDOW_LIST, USER_DECLINED};
    match code {
        USER_DECLINED => "screen recording permission was turned off".to_string(),
        NO_CAPTURE_SOURCE | NO_DISPLAY_LIST | NO_WINDOW_LIST => {
            "what you were recording went away".to_string()
        }
        _ => description,
    }
}

pub(super) fn create_recorder(
    path: &Path,
    size: CaptureSize,
    audio: &Inputs,
    timeline: Arc<Mutex<Timeline>>,
    window: Option<WindowFramer>,
) -> Result<arc::R<Recorder>> {
    let _ = std::fs::remove_file(path);
    let url = ns::Url::with_fs_path_str(&path.display().to_string(), false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::qt())
        .map_err(|err| anyhow!("could not create {}: {err:?}", path.display()))?;
    writer.set_movie_fragment_interval(cm::Time::new(2, 1));
    let bitrate = (size.width * size.height * 8) as i64;
    let compression = ns::Dictionary::with_keys_values(
        &[
            ns::str!(c"AverageBitRate"),
            ns::str!(c"MaxKeyFrameIntervalDuration"),
            ns::str!(c"AllowFrameReordering"),
        ],
        &[
            ns::Number::with_i64(bitrate).as_ref(),
            ns::Number::with_f64(0.25).as_ref(),
            ns::Number::with_bool(false).as_ref(),
        ],
    );
    let settings: arc::R<ns::Dictionary<ns::String, ns::Id>> = ns::Dictionary::with_keys_values(
        &[
            av::video::settings_keys::codec(),
            av::video::settings_keys::width(),
            av::video::settings_keys::height(),
            av::video::settings_keys::compression_props(),
        ],
        &[
            av::VideoCodec::h264().as_ref(),
            ns::Number::with_i64(size.width as i64).as_ref(),
            ns::Number::with_i64(size.height as i64).as_ref(),
            compression.as_ref(),
        ],
    );
    let mut input = av::AssetWriterInput::with_media_type_and_output_settings(
        av::MediaType::video(),
        Some(&settings),
    )
    .map_err(|err| anyhow!("video settings were rejected: {err:?}"))?;
    input.set_expects_media_data_in_real_time(true);
    writer
        .add_input(&input)
        .map_err(|err| anyhow!("could not add video input: {err:?}"))?;
    // A recorded window is drawn into the writer's own buffers, so they're asked for up front.
    let buffers: arc::R<ns::Dictionary<ns::String, ns::Id>> = ns::Dictionary::with_keys_values(
        &[
            cv::pixel_buffer_keys::pixel_format().as_ns(),
            cv::pixel_buffer_keys::width().as_ns(),
            cv::pixel_buffer_keys::height().as_ns(),
            cv::pixel_buffer_keys::io_surf_props().as_ns(),
        ],
        &[
            ns::Number::with_u32(cv::PixelFormat::_32_BGRA.0).as_ref(),
            ns::Number::with_i64(size.width as i64).as_ref(),
            ns::Number::with_i64(size.height as i64).as_ref(),
            ns::Dictionary::<ns::String, ns::Id>::new().as_ref(),
        ],
    );
    let adaptor = av::asset::WriterInputPixelBufAdaptor::with_input_writer(
        &input,
        window.is_some().then_some(&*buffers),
    )
    .map_err(|err| anyhow!("could not prepare the video input: {err:?}"))?;
    let system_audio = (audio.system_audio)
        .then(|| SoundTrack::new(&mut writer, 2))
        .transpose()?;
    let microphone = (audio.microphone_id.as_ref())
        .map(|_| SoundTrack::new(&mut writer, 1))
        .transpose()?;
    if !writer.start_writing() {
        return Err(write_error(&writer));
    }
    Ok(Recorder::with(RecorderState {
        writer,
        input,
        adaptor,
        system_audio,
        microphone,
        timeline,
        first_frame_time: None,
        window,
    }))
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    Finish(f64),
    Empty,
    Failed,
}

fn ending(status: Status, first_frame_time: Option<f64>) -> Ending {
    match (status, first_frame_time) {
        (Status::Writing, Some(time)) => Ending::Finish(time),
        (Status::Writing, None) => Ending::Empty,
        _ => Ending::Failed,
    }
}

/// Each time a recorded window's crop changed; see `WindowFramer::moves`.
pub(super) fn window_moves(recorder: &Recorder) -> Vec<[f64; 4]> {
    (recorder.inner().window.as_ref()).map_or_else(Vec::new, |window| window.moves.clone())
}

pub(super) fn finish_writing(recorder: &mut Recorder, video_end: f64) -> Result<f64> {
    let state = recorder.inner_mut();
    let first_frame_time = match ending(state.writer.status(), state.first_frame_time) {
        Ending::Finish(time) => time,
        Ending::Empty => {
            state.writer.cancel_writing();
            bail!("no video was captured");
        }
        Ending::Failed => return Err(write_error(&state.writer)),
    };
    state.input.mark_as_finished();
    for sound in [&mut state.system_audio, &mut state.microphone]
        .into_iter()
        .flatten()
    {
        sound.input.mark_as_finished();
    }
    let end = cm::Time::with_secs(video_end.max(first_frame_time), 1_000_000_000);
    if let Err(err) = state.writer.end_session_at_src_time(end) {
        log::warn!("could not end the video at the stop time: {err:?}");
    }
    let (done, mut on_done) = blocks::comp0();
    state.writer.finish_writing_with_ch_block(&mut on_done);
    wait("finishing the video", Duration::from_secs(30), done)?;
    if state.writer.status() != Status::Completed {
        return Err(write_error(&state.writer));
    }
    Ok(first_frame_time)
}

fn write_error(writer: &av::AssetWriter) -> anyhow::Error {
    match writer.error() {
        Some(err) => anyhow!("could not write the video: {:?}", *err),
        None => anyhow!("could not write the video"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framed_should_hold_a_window_in_its_starting_shape_inside_the_display() {
        let display = cg::Rect::new(0.0, 0.0, 1000.0, 800.0);
        let start = cg::Size {
            width: 400.0,
            height: 300.0,
        };
        let at = |x, y, w, h| framed(cg::Rect::new(x, y, w, h), start, display);
        // Moved: the crop is the window.
        assert_eq!(
            at(100.0, 50.0, 400.0, 300.0),
            cg::Rect::new(100.0, 50.0, 400.0, 300.0)
        );
        // Twice as wide: the crop grows to hold it at the starting shape, centered.
        assert_eq!(
            at(100.0, 100.0, 800.0, 300.0),
            cg::Rect::new(100.0, 0.0, 800.0, 600.0)
        );
        // Past the display's edge: the crop stops at the edge.
        assert_eq!(
            at(900.0, 700.0, 400.0, 300.0),
            cg::Rect::new(600.0, 500.0, 400.0, 300.0)
        );
    }

    #[test]
    fn window_at_should_give_the_newest_sample_so_far_and_drop_the_ones_behind() {
        let (first, second) = (
            cg::Rect::new(0.0, 0.0, 400.0, 300.0),
            cg::Rect::new(100.0, 50.0, 400.0, 300.0),
        );
        let mut log = vec![(1.0, first), (2.0, second), (3.0, first)];
        assert_eq!(window_at(&mut log, 0.5), Some(first));
        assert_eq!(window_at(&mut log, 1.9), Some(first));
        assert_eq!(log.len(), 3);
        assert_eq!(window_at(&mut log, 2.0), Some(second));
        assert_eq!(log.len(), 2);
        assert_eq!(window_at(&mut log, 9.0), Some(first));
        assert_eq!(log.len(), 1);
        assert_eq!(window_at(&mut Vec::new(), 1.0), None);
    }

    #[test]
    fn ending_should_finish_only_a_writer_that_is_fine_and_got_frames() {
        let cases = [
            (Status::Writing, Some(2.5), Ending::Finish(2.5)),
            (Status::Writing, None, Ending::Empty),
            (Status::Failed, Some(2.5), Ending::Failed),
            (Status::Cancelled, None, Ending::Failed),
        ];
        for (status, first_frame_time, expected) in cases {
            assert_eq!(ending(status, first_frame_time), expected, "{status:?}");
        }
    }

    #[test]
    fn stop_reason_should_name_the_common_causes_and_fall_back_to_apple() {
        let apple = || "The stream was stopped by the system".to_string();
        let cases = [
            (-3801, "screen recording permission was turned off"),
            (-3815, "what you were recording went away"),
            (-3814, "what you were recording went away"),
            (-3821, "The stream was stopped by the system"),
        ];
        for (code, expected) in cases {
            assert_eq!(stop_reason(code, apple()), expected, "{code}");
        }
    }
}
