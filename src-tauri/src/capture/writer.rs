#![expect(
    clippy::useless_transmute,
    reason = "the lint fires inside cidre's define_obj_type! macro, not in this code"
)]

use std::{
    path::Path,
    sync::{Arc, Mutex, mpsc},
};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{
    arc, av,
    av::AssetWriterStatus as Status,
    cf, cm, define_obj_type, ns, objc, os,
    sc::{
        self,
        stream::{Delegate, DelegateImpl, Output, OutputImpl},
    },
};

use super::Audio;
use super::plan::CaptureSize;
use super::timeline::Timeline;
use crate::util::lock;

pub(super) struct RecorderState {
    writer: arc::R<av::AssetWriter>,
    input: arc::R<av::AssetWriterInput>,
    adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
    system_audio: Option<SoundTrack>,
    microphone: Option<SoundTrack>,
    timeline: Arc<Mutex<Timeline>>,
    first_frame_time: Option<f64>,
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

    fn add(&mut self, sample_buf: &cm::SampleBuf, timeline: &Mutex<Timeline>) {
        let captured = sample_buf.pts();
        let Some(video_time) = lock(timeline).video_time(captured.as_secs()) else {
            return;
        };
        let cut = ((captured.as_secs() - video_time) * f64::from(captured.scale)).round() as i64;
        let pts = cm::Time::new(captured.value - cut, captured.scale);
        if pts < self.end || !self.input.is_ready_for_more_media_data() {
            return;
        }
        let Ok(timing) = sample_buf.timing_info(0) else {
            return;
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
    }
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

define_obj_type!(pub Recorder + OutputImpl, RecorderState, RECORDER);

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
            {
                track.add(sample_buf, &state.timeline);
            }
            return;
        }
        let Some(image) = sample_buf.image_buf() else {
            return;
        };
        let captured = sample_buf.pts();
        let Some(video_time) = lock(&state.timeline).video_time(captured.as_secs()) else {
            return;
        };
        let pts = cm::Time::with_secs(video_time, captured.scale);
        if state.first_frame_time.is_none() {
            if state.writer.status() != Status::Writing {
                return;
            }
            state.writer.start_session_at_src_time(pts);
            state.first_frame_time = Some(captured.as_secs());
        }
        if state.input.is_ready_for_more_media_data() {
            let _ = state.adaptor.append_pixel_buf_with_pts(image, pts);
        }
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
    audio: &Audio,
    timeline: Arc<Mutex<Timeline>>,
) -> Result<arc::R<Recorder>> {
    let _ = std::fs::remove_file(path);
    let url = ns::Url::with_fs_path_str(&path.display().to_string(), false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::qt())
        .map_err(|err| anyhow!("could not create {}: {err:?}", path.display()))?;
    writer.set_movie_fragment_interval(cm::Time::new(2, 1));
    let bitrate = (size.width * size.height * 8) as i64;
    let compression = ns::Dictionary::with_keys_values(
        &[ns::str!(c"AverageBitRate")],
        &[ns::Number::with_i64(bitrate).as_ref()],
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
    let adaptor = av::asset::WriterInputPixelBufAdaptor::with_input_writer(&input, None)
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
        eprintln!("could not end the video at the stop time: {err:?}");
    }
    let (done_tx, done_rx) = mpsc::channel();
    state.writer.finish_writing_with_ch(move || {
        let _ = done_tx.send(());
    });
    done_rx.recv().context("the file writer never finished")?;
    if state.writer.status() != Status::Completed {
        return Err(write_error(&state.writer));
    }
    Ok(first_frame_time)
}

fn write_error(writer: &av::AssetWriter) -> anyhow::Error {
    match writer.error() {
        Some(err) => anyhow!("could not write the video: {}", *err),
        None => anyhow!("could not write the video"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
