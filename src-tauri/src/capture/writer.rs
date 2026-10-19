//! The file writer: an H.264 `.mov` written in fragments, so a crash only loses the last few
//! seconds. ScreenCaptureKit hands each frame to the `Recorder`, which appends it, leaving out
//! frames captured while paused and closing the gaps pauses leave.

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
    cm, define_obj_type, ns, objc,
    sc::{
        self,
        stream::{Output, OutputImpl},
    },
};

use super::plan::CaptureSize;
use super::timeline::Timeline;
use crate::util::lock;

/// What the `Recorder` needs between calls from ScreenCaptureKit.
pub(super) struct RecorderState {
    writer: arc::R<av::AssetWriter>,
    input: arc::R<av::AssetWriterInput>,
    /// Appends frames at a chosen time, which is how pauses are cut out.
    adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
    timeline: Arc<Mutex<Timeline>>,
    /// Host-clock time of the first frame, in seconds. `None` until a frame arrives.
    first_frame_time: Option<f64>,
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
        if kind != sc::OutputType::Screen {
            return;
        }
        let state = self.inner_mut();
        // ScreenCaptureKit also sends "nothing changed" frames with no image; skip those.
        let Some(image) = sample_buf.image_buf() else {
            return;
        };
        let captured = sample_buf.pts();
        let Some(video_time) = lock(&state.timeline).video_time(captured.as_secs()) else {
            return;
        };
        let pts = cm::Time::with_secs(video_time, captured.scale);
        if state.first_frame_time.is_none() {
            // Starting a session on a writer that already failed would throw. Stopping reports
            // the failure instead.
            if state.writer.status() != Status::Writing {
                return;
            }
            state.writer.start_session_at_src_time(pts);
            state.first_frame_time = Some(captured.as_secs());
        }
        if state.input.is_ready_for_more_media_data() {
            // A frame that doesn't go in means the writer failed, and stopping reports that.
            let _ = state.adaptor.append_pixel_buf_with_pts(image, pts);
        }
    }
}

/// Starts writing a `.mov` of `size` at `path`, and returns the `Recorder` that feeds it.
pub(super) fn create_recorder(
    path: &Path,
    size: CaptureSize,
    timeline: Arc<Mutex<Timeline>>,
) -> Result<arc::R<Recorder>> {
    // Usually there's nothing to remove. A file that can't be removed makes the writer fail below.
    let _ = std::fs::remove_file(path);
    let url = ns::Url::with_fs_path_str(&path.display().to_string(), false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::qt())
        .map_err(|err| anyhow!("could not create {}: {err:?}", path.display()))?;
    // The file is finished up to the latest frame every 2 seconds, so a crash loses at most that.
    writer.set_movie_fragment_interval(cm::Time::new(2, 1));
    // 8 bits per pixel per second. cidre has no named constant for AVVideoAverageBitRateKey; its
    // value is "AverageBitRate".
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
    if !writer.start_writing() {
        return Err(write_error(&writer));
    }
    Ok(Recorder::with(RecorderState {
        writer,
        input,
        adaptor,
        timeline,
        first_frame_time: None,
    }))
}

/// How a recording's file can end.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    /// Frames arrived and the writer is still fine.
    Finish(f64),
    /// Still fine, but no frame ever arrived, so there's no video to finish.
    Empty,
    /// The writer gave up, on a full disk say. Finishing it would throw.
    Failed,
}

fn ending(status: Status, first_frame_time: Option<f64>) -> Ending {
    match (status, first_frame_time) {
        (Status::Writing, Some(time)) => Ending::Finish(time),
        (Status::Writing, None) => Ending::Empty,
        _ => Ending::Failed,
    }
}

/// Closes the file, and returns the host-clock time of its first frame. A writer that failed or
/// never got a frame is reported as an error, instead of handing back a broken file.
pub(super) fn finish_writing(recorder: &mut Recorder) -> Result<f64> {
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
    let (done_tx, done_rx) = mpsc::channel();
    state.writer.finish_writing_with_ch(move || {
        // Can't fail: `done_rx` is waiting below.
        let _ = done_tx.send(());
    });
    done_rx.recv().context("the file writer never finished")?;
    if state.writer.status() != Status::Completed {
        return Err(write_error(&state.writer));
    }
    Ok(first_frame_time)
}

/// Why the writer failed, in macOS's words.
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
}
