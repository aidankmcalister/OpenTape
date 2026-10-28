use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use super::{file_url, reason};
use anyhow::{Context, Result, ensure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReaderAudioMixOutput, AVAssetReaderOutput, AVAssetReaderVideoCompositionOutput,
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio,
    AVMediaTypeVideo, AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264,
    AVVideoCompressionPropertiesKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalDurationKey,
    AVVideoWidthKey,
};
use objc2_avf_audio::{AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_foundation::{CFDictionary, CFNumber, CFString, CFURL};
use objc2_core_image::{CIContext, CIImage};
use objc2_core_media::{CMFormatDescription, CMTime, kCMTimeZero};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use objc2_image_io::{
    CGImageDestination, kCGImagePropertyGIFDelayTime, kCGImagePropertyGIFDictionary,
    kCGImagePropertyGIFLoopCount,
};

struct Feed<'a> {
    name: &'static str,
    samples: &'a AVAssetReaderOutput,
    input: Retained<AVAssetWriterInput>,
    is_finished: bool,
}

impl Feed<'_> {
    fn write_next(&mut self, writer: &AVAssetWriter) -> Result<Option<CMTime>> {
        if self.is_finished || !unsafe { self.input.isReadyForMoreMediaData() } {
            return Ok(None);
        }
        let Some(sample) = (unsafe { self.samples.copyNextSampleBuffer() }) else {
            unsafe { self.input.markAsFinished() };
            self.is_finished = true;
            return Ok(None);
        };
        ensure!(
            unsafe { self.input.appendSampleBuffer(&sample) },
            "could not write the {}: {}",
            self.name,
            reason(unsafe { writer.error() })
        );
        Ok(Some(unsafe { sample.presentation_time_stamp() }))
    }
}

pub(super) fn write_mp4(
    frames: &AVAssetReaderOutput,
    samples: Option<&AVAssetReaderAudioMixOutput>,
    output: &Path,
    settings: Option<&NSDictionary<NSString, AnyObject>>,
    hint: Option<&CMFormatDescription>,
    progress_at: impl Fn(CMTime),
) -> Result<()> {
    let video_type = unsafe { AVMediaTypeVideo }.context("AVFoundation has no video type")?;
    let mp4 = unsafe { AVFileTypeMPEG4 }.context("AVFoundation has no MP4 type")?;
    let _ = std::fs::remove_file(output);
    let writer =
        unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&file_url(output), mp4) }
            .map_err(|error| {
                anyhow::anyhow!("could not start the file: {}", reason(Some(error)))
            })?;
    let input = unsafe {
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings_sourceFormatHint(
            video_type, settings, hint,
        )
    };
    unsafe {
        input.setExpectsMediaDataInRealTime(false);
        writer.addInput(&input);
    }
    let mut feeds = vec![Feed {
        name: "video",
        samples: frames,
        input,
        is_finished: false,
    }];
    if let Some(samples) = samples {
        feeds.push(Feed {
            name: "sound",
            samples,
            input: aac_input(&writer)?,
            is_finished: false,
        });
    }
    ensure!(
        unsafe { writer.startWriting() },
        "could not start the file: {}",
        reason(unsafe { writer.error() })
    );
    unsafe { writer.startSessionAtSourceTime(kCMTimeZero) };
    while feeds.iter().any(|feed| !feed.is_finished) {
        let mut wrote = false;
        for (index, feed) in feeds.iter_mut().enumerate() {
            if let Some(time) = feed.write_next(&writer)? {
                wrote = true;
                if index == 0 {
                    progress_at(time);
                }
            }
        }
        if !wrote {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    let (finished, wait) = mpsc::channel();
    let on_finish = RcBlock::new(move || {
        let _ = finished.send(());
    });
    unsafe { writer.finishWritingWithCompletionHandler(&on_finish) };
    wait.recv_timeout(Duration::from_secs(30))
        .context("finishing the file took longer than 30 seconds")?;
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

fn aac_input(writer: &AVAssetWriter) -> Result<Retained<AVAssetWriterInput>> {
    let key =
        |key: Option<&'static NSString>| key.context("AVFoundation is missing an audio setting");
    let audio_type = unsafe { AVMediaTypeAudio }.context("AVFoundation has no audio type")?;
    let values = [
        NSNumber::new_u32(u32::from_be_bytes(*b"aac ")),
        NSNumber::new_f64(48_000.0),
        NSNumber::new_u32(2),
    ];
    let settings = NSDictionary::<NSString, AnyObject>::from_slices(
        &[
            key(unsafe { AVFormatIDKey })?,
            key(unsafe { AVSampleRateKey })?,
            key(unsafe { AVNumberOfChannelsKey })?,
        ],
        &values.each_ref().map(|value| value.as_ref()),
    );
    let input = unsafe {
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(
            audio_type,
            Some(&settings),
        )
    };
    unsafe {
        input.setExpectsMediaDataInRealTime(false);
        writer.addInput(&input);
    }
    Ok(input)
}

fn hundredths(seconds: f64) -> i32 {
    (seconds * 100.0).round() as i32
}

pub(super) fn h264(
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
