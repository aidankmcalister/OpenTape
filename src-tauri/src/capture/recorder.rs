//! The object ScreenCaptureKit hands frames to. It appends each frame to the file writer,
//! leaving out frames captured while paused and closing the gaps pauses leave.

#![expect(
    clippy::useless_transmute,
    reason = "the lint fires inside cidre's define_obj_type! macro, not in this code"
)]

use std::sync::{Arc, Mutex};

use cidre::{
    arc, av, cm, define_obj_type, objc,
    sc::{
        self,
        stream::{Output, OutputImpl},
    },
};

use super::timeline::Timeline;
use crate::util::lock;

/// What the frame receiver needs between calls from ScreenCaptureKit.
pub(super) struct RecorderState {
    pub writer: arc::R<av::AssetWriter>,
    pub input: arc::R<av::AssetWriterInput>,
    /// Appends frames at a chosen time, which is how pauses are cut out.
    adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
    timeline: Arc<Mutex<Timeline>>,
    /// Host-clock time of the first frame, in seconds. `None` until a frame arrives.
    pub first_frame_time: Option<f64>,
}

impl RecorderState {
    pub(super) fn new(
        writer: arc::R<av::AssetWriter>,
        input: arc::R<av::AssetWriterInput>,
        adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
        timeline: Arc<Mutex<Timeline>>,
    ) -> Self {
        Self {
            writer,
            input,
            adaptor,
            timeline,
            first_frame_time: None,
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
        if kind != sc::OutputType::Screen {
            return;
        }
        // ScreenCaptureKit also sends "nothing changed" frames with no image; skip those.
        let Some(image) = sample_buf.image_buf() else {
            return;
        };
        let captured = sample_buf.pts();
        let state = self.inner_mut();
        let placed = lock(&state.timeline).place(captured.as_secs());
        let Some(placed) = placed else {
            return;
        };
        let pts = cm::Time::with_secs(placed, captured.scale);
        if state.first_frame_time.is_none() {
            // Starting a session on a writer that already failed would throw. Stopping reports
            // the failure instead.
            if state.writer.status() != av::AssetWriterStatus::Writing {
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
