//! The file writer: an H.264 `.mov` written in fragments, so a crash only loses the last few
//! seconds. The [`Recorder`](super::recorder::Recorder) feeds it frames.

use std::{path::Path, sync::mpsc};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{arc, av, av::AssetWriterStatus as Status, cm, ns};

use super::plan::CaptureSize;
use super::recorder::Recorder;

const FRAGMENT_SECONDS: i64 = 2;

pub(super) type Writer = (
    arc::R<av::AssetWriter>,
    arc::R<av::AssetWriterInput>,
    arc::R<av::asset::WriterInputPixelBufAdaptor>,
);

pub(super) fn create_writer(path: &Path, size: CaptureSize) -> Result<Writer> {
    // Usually there's nothing to remove. A file that can't be removed makes the writer fail below.
    let _ = std::fs::remove_file(path);
    let url = ns::Url::with_fs_path_str(&path.display().to_string(), false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::qt())
        .map_err(|err| anyhow!("could not create {}: {err:?}", path.display()))?;
    // CONTEXT: finishing the file in 2-second fragments means a crash only loses the last fragment.
    writer.set_movie_fragment_interval(cm::Time::new(FRAGMENT_SECONDS, 1));

    let mut input = av::AssetWriterInput::with_media_type_and_output_settings(
        av::MediaType::video(),
        Some(&video_settings(size)),
    )
    .map_err(|err| anyhow!("video settings were rejected: {err:?}"))?;
    input.set_expects_media_data_in_real_time(true);
    writer
        .add_input(&input)
        .map_err(|err| anyhow!("could not add video input: {err:?}"))?;
    let adaptor = av::asset::WriterInputPixelBufAdaptor::with_input_writer(&input, None)
        .map_err(|err| anyhow!("could not prepare the video input: {err:?}"))?;
    if !writer.start_writing() {
        return Err(failure(&writer));
    }
    Ok((writer, input, adaptor))
}

fn video_settings(size: CaptureSize) -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    // CONTEXT: cidre has no named constant for AVVideoAverageBitRateKey; its value is "AverageBitRate".
    let compression = ns::Dictionary::with_keys_values(
        &[ns::str!(c"AverageBitRate")],
        &[ns::Number::with_i64(size.bitrate()).as_ref()],
    );
    ns::Dictionary::with_keys_values(
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
    )
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
        Ending::Failed => return Err(failure(&state.writer)),
    };
    state.input.mark_as_finished();
    let (done_tx, done_rx) = mpsc::channel();
    state.writer.finish_writing_with_ch(move || {
        // Can't fail: `done_rx` is waiting below.
        let _ = done_tx.send(());
    });
    done_rx.recv().context("the file writer never finished")?;
    if state.writer.status() != Status::Completed {
        return Err(failure(&state.writer));
    }
    Ok(first_frame_time)
}

/// Why the writer failed, in macOS's words.
fn failure(writer: &av::AssetWriter) -> anyhow::Error {
    match writer.error() {
        Some(err) => anyhow!("could not write the video: {}", *err),
        None => anyhow!("could not write the video"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ending_should_finish_a_writer_that_got_frames() {
        assert_eq!(ending(Status::Writing, Some(2.5)), Ending::Finish(2.5));
    }

    #[test]
    fn ending_should_not_finish_a_writer_without_frames() {
        assert_eq!(ending(Status::Writing, None), Ending::Empty);
    }

    #[test]
    fn ending_should_report_a_writer_that_failed() {
        assert_eq!(ending(Status::Failed, Some(2.5)), Ending::Failed);
        assert_eq!(ending(Status::Cancelled, None), Ending::Failed);
    }
}
