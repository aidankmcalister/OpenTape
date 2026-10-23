use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use super::{ExportLayout, ExportOptions, file_url, reason};
use anyhow::{Context, Result, ensure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReaderVideoCompositionOutput, AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus,
    AVFileTypeMPEG4, AVMediaTypeVideo, AVVideoAverageBitRateKey, AVVideoCodecKey,
    AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey, AVVideoHeightKey,
    AVVideoMaxKeyFrameIntervalDurationKey, AVVideoWidthKey,
};
use objc2_core_foundation::{CFDictionary, CFNumber, CFString, CFURL};
use objc2_core_image::{CIContext, CIImage};
use objc2_core_media::{CMTime, kCMTimeZero};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use objc2_image_io::{
    CGImageDestination, kCGImagePropertyGIFDelayTime, kCGImagePropertyGIFDictionary,
    kCGImagePropertyGIFLoopCount,
};

pub(super) fn write_mp4(
    frames: &AVAssetReaderVideoCompositionOutput,
    output: &Path,
    layout: &ExportLayout,
    options: &ExportOptions,
    progress_at: impl Fn(CMTime),
) -> Result<()> {
    let video_type = unsafe { AVMediaTypeVideo }.context("AVFoundation has no video type")?;
    let mp4 = unsafe { AVFileTypeMPEG4 }.context("AVFoundation has no MP4 type")?;
    let writer =
        unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&file_url(output), mp4) }
            .map_err(|error| {
                anyhow::anyhow!("could not start the file: {}", reason(Some(error)))
            })?;
    let settings = h264(layout.width, layout.height, options.bits_per_pixel)?;
    let input = unsafe {
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            video_type,
            Some(&settings),
        )
    };
    unsafe {
        input.setExpectsMediaDataInRealTime(false);
        writer.addInput(&input);
    }
    ensure!(
        unsafe { writer.startWriting() },
        "could not start the file: {}",
        reason(unsafe { writer.error() })
    );
    unsafe { writer.startSessionAtSourceTime(kCMTimeZero) };
    while let Some(frame) = unsafe { frames.copyNextSampleBuffer() } {
        while !unsafe { input.isReadyForMoreMediaData() } {
            std::thread::sleep(Duration::from_millis(2));
        }
        ensure!(
            unsafe { input.appendSampleBuffer(&frame) },
            "could not write a frame: {}",
            reason(unsafe { writer.error() })
        );
        progress_at(unsafe { frame.presentation_time_stamp() });
    }
    unsafe { input.markAsFinished() };
    let (finished, wait) = mpsc::channel();
    let on_finish = RcBlock::new(move || {
        let _ = finished.send(());
    });
    unsafe { writer.finishWritingWithCompletionHandler(&on_finish) };
    let _ = wait.recv();
    ensure!(
        unsafe { writer.status() } == AVAssetWriterStatus::Completed,
        "could not finish the file: {}",
        reason(unsafe { writer.error() })
    );
    Ok(())
}

pub(super) fn write_gif(
    frames: &AVAssetReaderVideoCompositionOutput,
    output: &Path,
    frame_rate: u32,
    duration: f64,
    progress_at: impl Fn(CMTime),
) -> Result<()> {
    let url = CFURL::from_file_path(output).context("the GIF's path isn't a file URL")?;
    let count = (duration * f64::from(frame_rate)).ceil() as usize + 1;
    let gif = unsafe {
        CGImageDestination::with_url(
            &url,
            &CFString::from_static_str("com.compuserve.gif"),
            count,
            None,
        )
    }
    .context("could not start the GIF")?;
    let gif_entry = |key: &CFString, value: &CFNumber| {
        let inner = CFDictionary::<CFString, CFNumber>::from_slices(&[key], &[value]);
        CFDictionary::<CFString, CFDictionary>::from_slices(
            &[unsafe { kCGImagePropertyGIFDictionary }],
            &[inner.as_ref()],
        )
    };
    let forever = gif_entry(
        unsafe { kCGImagePropertyGIFLoopCount },
        &CFNumber::new_i32(0),
    );
    unsafe { gif.set_properties(Some(forever.as_ref())) };
    let context = unsafe { CIContext::context() };
    let mut shown_until = 0;
    while let Some(frame) = unsafe { frames.copyNextSampleBuffer() } {
        let start = unsafe { frame.presentation_time_stamp().seconds() };
        let ends = hundredths(start + 1.0 / f64::from(frame_rate));
        let delay = gif_entry(
            unsafe { kCGImagePropertyGIFDelayTime },
            &CFNumber::new_f64(f64::from(ends - shown_until) / 100.0),
        );
        shown_until = ends;
        let pixels = unsafe { frame.image_buffer() }.context("a frame had no picture")?;
        let image = unsafe { CIImage::imageWithCVImageBuffer(&pixels) };
        let picture = unsafe { context.createCGImage_fromRect(&image, image.extent()) }
            .context("could not draw a frame of the GIF")?;
        unsafe { gif.add_image(&picture, Some(delay.as_ref())) };
        progress_at(unsafe { frame.presentation_time_stamp() });
    }
    ensure!(unsafe { gif.finalize() }, "could not finish the GIF");
    Ok(())
}

fn hundredths(seconds: f64) -> i32 {
    (seconds * 100.0).round() as i32
}

fn h264(
    width: u32,
    height: u32,
    bits_per_pixel: f64,
) -> Result<Retained<NSDictionary<NSString, AnyObject>>> {
    let key =
        |key: Option<&'static NSString>| key.context("AVFoundation is missing a video setting");
    let bitrate = NSNumber::new_f64(f64::from(width) * f64::from(height) * bits_per_pixel);
    let keyframe_every = NSNumber::new_f64(1.0);
    let compression = NSDictionary::<NSString, NSNumber>::from_slices(
        &[
            key(unsafe { AVVideoAverageBitRateKey })?,
            key(unsafe { AVVideoMaxKeyFrameIntervalDurationKey })?,
        ],
        &[&bitrate, &keyframe_every],
    );
    let codec = key(unsafe { AVVideoCodecTypeH264 })?;
    let (width, height) = (NSNumber::new_u32(width), NSNumber::new_u32(height));
    let values: [&AnyObject; 4] = [
        codec.as_ref(),
        width.as_ref(),
        height.as_ref(),
        compression.as_ref(),
    ];
    Ok(NSDictionary::from_slices(
        &[
            key(unsafe { AVVideoCodecKey })?,
            key(unsafe { AVVideoWidthKey })?,
            key(unsafe { AVVideoHeightKey })?,
            key(unsafe { AVVideoCompressionPropertiesKey })?,
        ],
        &values,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gif_delays_add_up_to_the_real_length() {
        let ends: Vec<i32> = (0..30)
            .map(|frame| hundredths(f64::from(frame + 1) / 30.0))
            .collect();
        let delays: Vec<i32> = std::iter::once(ends[0])
            .chain(ends.windows(2).map(|pair| pair[1] - pair[0]))
            .collect();
        assert_eq!(delays.iter().sum::<i32>(), 100);
        assert!(delays.iter().all(|delay| (3..=4).contains(delay)));
    }
}
