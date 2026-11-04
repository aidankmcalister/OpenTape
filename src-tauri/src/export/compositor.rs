//! Draws each exported frame. AVFoundation's built-in Core Image composition hands
//! every source frame over as 32-bit color, and converting a 4K recording that way
//! cost more than the rest of the export. This compositor asks for frames in the
//! recording's own 4:2:0 format and lets Core Image convert them on the GPU.
//!
//! AVFoundation makes the compositor itself, so the frame drawing for the export
//! in progress lives in `DRAWING`, and `ONE_AT_A_TIME` keeps exports from sharing it.

use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, ClassType, DefinedClass, define_class, msg_send};
use objc2_av_foundation::{
    AVAssetTrack, AVAsynchronousVideoCompositionRequest, AVMutableVideoComposition,
    AVVideoCompositing, AVVideoCompositionInstructionProtocol, AVVideoCompositionRenderContext,
};
use objc2_core_foundation::CFString;
use objc2_core_image::{CIContext, CIImage, kCIContextCacheIntermediates};
use objc2_core_media::{CMPersistentTrackID, CMTimeRange, kCMPersistentTrackID_Invalid};
use objc2_core_video::{
    kCVPixelBufferPixelFormatTypeKey, kCVPixelFormatType_32BGRA,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSString, NSValue};

use crate::util::lock;

/// Turns a source frame at an output time (in seconds) into the finished frame.
pub(super) type DrawFrame = Box<dyn Fn(f64, &CIImage) -> Retained<CIImage>>;

struct Drawing {
    draw: DrawFrame,
    context: Retained<CIContext>,
}

// Core Image images and contexts are safe to use from any thread, and the export
// waits for AVFoundation to finish every frame before it clears `DRAWING`.
unsafe impl Send for Drawing {}

static DRAWING: Mutex<Option<Drawing>> = Mutex::new(None);
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// The export holding this draws every frame; dropping it lets the next one start.
pub(super) struct Turn(#[allow(dead_code)] MutexGuard<'static, ()>);

impl Drop for Turn {
    fn drop(&mut self) {
        *lock(&DRAWING) = None;
    }
}

/// Points `composition` at this compositor for the whole of `range` on `track`,
/// and makes `draw` the frame drawing until the returned turn is dropped.
pub(super) fn use_compositor(
    composition: &AVMutableVideoComposition,
    track: &AVAssetTrack,
    range: CMTimeRange,
    draw: DrawFrame,
) -> Turn {
    let turn = lock(&ONE_AT_A_TIME);
    let options = NSDictionary::<NSString, AnyObject>::from_slices(
        &[unsafe { kCIContextCacheIntermediates }],
        &[&*NSNumber::new_bool(false) as &AnyObject],
    );
    let context = unsafe { CIContext::contextWithOptions(Some(&options)) };
    *lock(&DRAWING) = Some(Drawing { draw, context });
    let instruction = Instruction::new(Span {
        range,
        track: unsafe { track.trackID() },
    });
    unsafe {
        let _: () = msg_send![composition, setCustomVideoCompositorClass: Compositor::class()];
        composition.setInstructions(&NSArray::from_retained_slice(&[
            ProtocolObject::from_retained(instruction),
        ]));
    }
    Turn(turn)
}

fn pixel_format(format: u32) -> Retained<NSDictionary<NSString, AnyObject>> {
    let key: &CFString = unsafe { kCVPixelBufferPixelFormatTypeKey };
    let key = unsafe { &*std::ptr::from_ref(key).cast::<NSString>() };
    NSDictionary::from_slices(&[key], &[&*NSNumber::new_u32(format) as &AnyObject])
}

fn compose(request: &AVAsynchronousVideoCompositionRequest) -> Result<()> {
    let drawing = lock(&DRAWING);
    let drawing = drawing.as_ref().context("no export is drawing frames")?;
    let track = unsafe { request.sourceTrackIDs() }
        .firstObject()
        .context("the frame has no video")?;
    let source = unsafe { request.sourceFrameByTrackID(track.intValue()) }
        .context("the frame could not be read")?;
    let output = unsafe { request.renderContext().newPixelBuffer() }
        .context("there is no room for the next frame")?;
    let now = unsafe { request.compositionTime().seconds() };
    let image = (drawing.draw)(now, &*unsafe { CIImage::imageWithCVPixelBuffer(&source) });
    unsafe {
        drawing.context.render_toCVPixelBuffer(&image, &output);
        request.finishWithComposedVideoFrame(&output);
    }
    Ok(())
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "OpenTapeCompositor"]
    struct Compositor;

    unsafe impl NSObjectProtocol for Compositor {}

    unsafe impl AVVideoCompositing for Compositor {
        #[unsafe(method_id(sourcePixelBufferAttributes))]
        fn source_pixel_buffer_attributes(
            &self,
        ) -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
            Some(pixel_format(
                kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            ))
        }

        #[unsafe(method_id(requiredPixelBufferAttributesForRenderContext))]
        fn required_pixel_buffer_attributes(&self) -> Retained<NSDictionary<NSString, AnyObject>> {
            pixel_format(kCVPixelFormatType_32BGRA)
        }

        #[unsafe(method(renderContextChanged:))]
        fn render_context_changed(&self, _context: &AVVideoCompositionRenderContext) {}

        #[unsafe(method(startVideoCompositionRequest:))]
        fn start_video_composition_request(&self, request: &AVAsynchronousVideoCompositionRequest) {
            if let Err(err) = compose(request) {
                log::error!("could not draw an exported frame: {err:#}");
                let error = NSError::new(-1, &NSString::from_str("OpenTape"));
                unsafe { request.finishWithError(&error) };
            }
        }
    }
);

struct Span {
    range: CMTimeRange,
    track: CMPersistentTrackID,
}

// One instruction for the whole export that says its frames change over time,
// so the zoom and cursor keep moving at the export's frame rate even while the
// recording itself holds still.
define_class!(
    #[unsafe(super(NSObject))]
    #[name = "OpenTapeInstruction"]
    #[ivars = Span]
    struct Instruction;

    unsafe impl NSObjectProtocol for Instruction {}

    unsafe impl AVVideoCompositionInstructionProtocol for Instruction {
        #[unsafe(method(timeRange))]
        fn time_range(&self) -> CMTimeRange {
            self.ivars().range
        }

        #[unsafe(method(enablePostProcessing))]
        fn enable_post_processing(&self) -> bool {
            false
        }

        #[unsafe(method(containsTweening))]
        fn contains_tweening(&self) -> bool {
            true
        }

        #[unsafe(method_id(requiredSourceTrackIDs))]
        fn required_source_track_ids(&self) -> Option<Retained<NSArray<NSValue>>> {
            let track = NSNumber::new_i32(self.ivars().track);
            Some(NSArray::from_retained_slice(&[Retained::into_super(track)]))
        }

        #[unsafe(method(passthroughTrackID))]
        fn passthrough_track_id(&self) -> CMPersistentTrackID {
            kCMPersistentTrackID_Invalid
        }
    }
);

impl Instruction {
    fn new(span: Span) -> Retained<Self> {
        let this = Self::alloc().set_ivars(span);
        unsafe { msg_send![super(this), init] }
    }
}
