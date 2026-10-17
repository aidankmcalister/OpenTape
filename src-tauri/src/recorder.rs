//! The object ScreenCaptureKit hands frames to. It appends each frame to the file writer.

#![expect(
    clippy::useless_transmute,
    reason = "the lint fires inside cidre's define_obj_type! macro, not in this code"
)]

use cidre::{
    arc, av, cm, define_obj_type, objc,
    sc::{
        self,
        stream::{Output, OutputImpl},
    },
};

/// What the frame receiver needs between calls from ScreenCaptureKit.
pub struct RecorderState {
    pub writer: arc::R<av::AssetWriter>,
    pub input: arc::R<av::AssetWriterInput>,
    /// Host-clock time of the first frame, in seconds. `None` until a frame arrives.
    pub first_frame_time: Option<f64>,
    pub frames: usize,
}

impl RecorderState {
    pub fn new(writer: arc::R<av::AssetWriter>, input: arc::R<av::AssetWriterInput>) -> Self {
        Self {
            writer,
            input,
            first_frame_time: None,
            frames: 0,
        }
    }
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
        // ScreenCaptureKit also sends "nothing changed" frames with no image; skip those.
        if kind != sc::OutputType::Screen || sample_buf.image_buf().is_none() {
            return;
        }
        let state = self.inner_mut();
        if state.first_frame_time.is_none() {
            state.writer.start_session_at_src_time(sample_buf.pts());
            state.first_frame_time = Some(sample_buf.pts().as_secs());
        }
        if state.input.is_ready_for_more_media_data()
            && state.input.append_sample_buf(sample_buf).is_ok()
        {
            state.frames += 1;
        }
    }
}
