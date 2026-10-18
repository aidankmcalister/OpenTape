//! The file writer: an H.264 `.mov` written in fragments, so a crash only loses the last few
//! seconds. The [`Recorder`](super::recorder::Recorder) feeds it frames.

use std::{path::Path, sync::mpsc};

use anyhow::{Context, Result, anyhow};
use cidre::{arc, av, cm, ns};

use super::plan::CaptureSize;
use super::recorder::Recorder;

const FRAGMENT_SECONDS: i64 = 2;

pub(super) type Writer = (
    arc::R<av::AssetWriter>,
    arc::R<av::AssetWriterInput>,
    arc::R<av::asset::WriterInputPixelBufAdaptor>,
);

pub(super) fn create_writer(path: &Path, size: CaptureSize) -> Result<Writer> {
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
    writer.start_writing();
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

/// Closes the file, and returns the host-clock time of its first frame, if any arrived.
pub(super) fn finish_writing(recorder: &mut Recorder) -> Result<Option<f64>> {
    let state = recorder.inner_mut();
    state.input.mark_as_finished();
    let (done_tx, done_rx) = mpsc::channel();
    state.writer.finish_writing_with_ch(move || {
        let _ = done_tx.send(());
    });
    done_rx.recv().context("the file writer never finished")?;
    Ok(state.first_frame_time)
}
