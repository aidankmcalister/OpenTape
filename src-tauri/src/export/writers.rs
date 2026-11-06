use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use super::{file_url, reason};
use anyhow::{Context, Result, anyhow, ensure};
use block2::RcBlock;
use gif::{DisposalMethod, Encoder, Frame, Repeat};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReaderAudioMixOutput, AVAssetReaderOutput, AVAssetReaderVideoCompositionOutput,
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio,
    AVMediaTypeVideo, AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264,
    AVVideoCodecTypeHEVC, AVVideoCompressionPropertiesKey, AVVideoHeightKey,
    AVVideoMaxKeyFrameIntervalDurationKey, AVVideoWidthKey,
};
use objc2_avf_audio::{AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_media::{CMTime, kCMTimeZero};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use quantette::deps::palette::Srgb;
use quantette::{ImageRef, PaletteSize, Pipeline, QuantizeMethod};

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
    settings: &NSDictionary<NSString, AnyObject>,
    progress_at: impl Fn(CMTime) -> Result<()>,
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
        AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(video_type, Some(settings))
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
                if index == 0
                    && let Err(err) = progress_at(time)
                {
                    unsafe { writer.cancelWriting() };
                    return Err(err);
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
    (width, height): (u32, u32),
    frame_rate: u32,
    progress_at: impl Fn(CMTime) -> Result<()>,
) -> Result<()> {
    let file = BufWriter::new(File::create(output).context("could not start the GIF")?);
    let mut gif = Encoder::new(file, width as u16, height as u16, &[])?;
    gif.set_repeat(Repeat::Infinite)?;
    let batch_size = std::thread::available_parallelism().map_or(4, |cores| cores.get());
    let mut shown = Vec::new();
    let mut parts = Vec::new();
    let mut held: Option<(Frame, i32)> = None;
    let mut ends = 0;
    while let Some(sample) = unsafe { frames.copyNextSampleBuffer() } {
        let time = unsafe { sample.presentation_time_stamp() };
        let start = unsafe { time.seconds() };
        ends = hundredths(start + 1.0 / f64::from(frame_rate));
        let pixels = unsafe { sample.image_buffer() }.context("a frame had no picture")?;
        parts.extend(changed_part(
            &rgba(&pixels),
            &mut shown,
            width as usize,
            hundredths(start),
        ));
        if parts.len() == batch_size {
            write_parts(&mut gif, &mut held, parts.drain(..))?;
        }
        progress_at(time)?;
    }
    write_parts(&mut gif, &mut held, parts.drain(..))?;
    if let Some((mut frame, from)) = held {
        frame.delay = (ends - from) as u16;
        gif.write_lzw_pre_encoded_frame(&frame)?;
    }
    gif.into_inner()?.flush()?;
    Ok(())
}

/// Turns parts into frames on every core, then writes them in order. Each
/// frame is held until the next one starts, which sets how long it shows.
fn write_parts(
    gif: &mut Encoder<BufWriter<File>>,
    held: &mut Option<(Frame<'static>, i32)>,
    parts: impl Iterator<Item = Part>,
) -> Result<()> {
    let parts: Vec<Part> = parts.collect();
    let frames: Vec<Frame> = std::thread::scope(|scope| {
        let workers: Vec<_> = (parts.iter())
            .map(|part| scope.spawn(|| part.frame()))
            .collect();
        (workers.into_iter())
            .map(|worker| worker.join().map_err(|_| anyhow!("a GIF frame failed"))?)
            .collect::<Result<_>>()
    })?;
    for (next, part) in frames.into_iter().zip(&parts) {
        if let Some((mut frame, from)) = held.replace((next, part.start)) {
            frame.delay = (part.start - from) as u16;
            gif.write_lzw_pre_encoded_frame(&frame)?;
        }
    }
    Ok(())
}

fn rgba(pixels: &CVPixelBuffer) -> Vec<u8> {
    let read_only = CVPixelBufferLockFlags::ReadOnly;
    unsafe { CVPixelBufferLockBaseAddress(pixels, read_only) };
    let row_bytes = CVPixelBufferGetBytesPerRow(pixels);
    let (width, height) = (
        CVPixelBufferGetWidth(pixels),
        CVPixelBufferGetHeight(pixels),
    );
    let base = CVPixelBufferGetBaseAddress(pixels).cast::<u8>();
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        let bgra = unsafe { std::slice::from_raw_parts(base.add(row * row_bytes), width * 4) };
        rgba.extend(
            bgra.as_chunks::<4>()
                .0
                .iter()
                .flat_map(|p| [p[2], p[1], p[0], 255]),
        );
    }
    unsafe { CVPixelBufferUnlockBaseAddress(pixels, read_only) };
    rgba
}

/// Pixels within this many shades of what was last written count as
/// unchanged, so video noise doesn't redraw the whole frame.
const SAME_COLOR: u8 = 3;
const SEE_THROUGH: u8 = 255;
/// Each frame's most common colors get exact palette slots. Without them a
/// flat background can come out a shade off in one frame and stay that way,
/// leaving faint ghosts where things moved.
const EXACT_COLORS: usize = 32;

/// The rectangle that changed since the last frame, with unchanged pixels
/// see-through (alpha 0), starting at `start` hundredths of a second.
struct Part {
    left: usize,
    top: usize,
    width: usize,
    rgba: Vec<u8>,
    start: i32,
}

/// Returns nothing when the frame matches what's showing, so the previous
/// frame just stays longer. `shown` holds the colors last written per pixel.
fn changed_part(rgba: &[u8], shown: &mut Vec<u8>, width: usize, start: i32) -> Option<Part> {
    let is_first = shown.is_empty();
    if is_first {
        shown.extend_from_slice(rgba);
    }
    let changed: Vec<usize> = (0..rgba.len() / 4)
        .filter(|&i| {
            is_first || (0..3).any(|c| rgba[i * 4 + c].abs_diff(shown[i * 4 + c]) > SAME_COLOR)
        })
        .collect();
    let (xs, ys) = (
        changed.iter().map(|i| i % width),
        changed.iter().map(|i| i / width),
    );
    let (left, right) = (xs.clone().min()?, xs.max()?);
    let (top, bottom) = (ys.clone().min()?, ys.max()?);
    let part_width = right - left + 1;
    let mut part: Vec<u8> = (top..=bottom)
        .flat_map(|y| &rgba[(y * width + left) * 4..(y * width + right + 1) * 4])
        .enumerate()
        .map(|(i, &c)| if i % 4 == 3 { 0 } else { c })
        .collect();
    for &i in &changed {
        part[((i / width - top) * part_width + i % width - left) * 4 + 3] = 255;
        shown[i * 4..i * 4 + 4].copy_from_slice(&rgba[i * 4..i * 4 + 4]);
    }
    Some(Part {
        left,
        top,
        width: part_width,
        rgba: part,
        start,
    })
}

impl Part {
    /// Picks this part's own palette and compresses it, ready to write.
    fn frame(&self) -> Result<Frame<'static>> {
        let pixels = self.rgba.as_chunks::<4>().0;
        let height = pixels.len() / self.width;
        let colors: Vec<Srgb<u8>> = (pixels.iter())
            .map(|p| Srgb::new(p[0], p[1], p[2]))
            .collect();
        let image = ImageRef::new(self.width as u32, height as u32, colors.as_slice())
            .map_err(|_| anyhow!("a GIF frame had the wrong size"))?;
        let mut counts = HashMap::<[u8; 3], u32>::new();
        for p in pixels {
            *counts.entry([p[0], p[1], p[2]]).or_default() += 1;
        }
        let mut exact: Vec<([u8; 3], u32)> = counts.into_iter().collect();
        exact.sort_unstable_by_key(|&(_, count)| std::cmp::Reverse(count));
        exact.truncate(EXACT_COLORS);
        let (rest, mut indices) = Pipeline::new()
            .palette_size(PaletteSize::from_u8_clamped(
                SEE_THROUGH - EXACT_COLORS as u8,
            ))
            .ditherer(None)
            .quantize_method(QuantizeMethod::Wu)
            .input_image(image)
            .output_srgb8_indexed_image()
            .into_parts();
        let slot: HashMap<[u8; 3], u8> = (exact.iter().enumerate())
            .map(|(i, (color, _))| (*color, i as u8))
            .collect();
        for (index, pixel) in indices.iter_mut().zip(pixels) {
            *index = match (pixel[3], slot.get(&[pixel[0], pixel[1], pixel[2]])) {
                (0, _) => SEE_THROUGH,
                (_, Some(&i)) => i,
                _ => *index + exact.len() as u8,
            };
        }
        let mut palette: Vec<u8> = (exact.iter().map(|(color, _)| *color))
            .chain(rest.iter().map(|c| [c.red, c.green, c.blue]))
            .flatten()
            .collect();
        palette.resize(256 * 3, 0);
        Ok(Frame {
            left: self.left as u16,
            top: self.top as u16,
            width: self.width as u16,
            height: height as u16,
            buffer: lzw(&indices).into(),
            palette: Some(palette),
            transparent: Some(SEE_THROUGH),
            dispose: DisposalMethod::Keep,
            ..Frame::default()
        })
    }
}

const CLEAR: u16 = 256;
const END: u16 = 257;
const FIRST_FREE: u16 = 258;
const LAST_CODE: u16 = 4095;

/// GIF's LZW compression of 8-bit palette indices, as the code-size byte and
/// packed codes `write_lzw_pre_encoded_frame` expects. Output, widening and
/// clearing follow giflib's order, which compresses screen recordings about
/// 20% better than the `gif` crate's own encoder.
fn lzw(indices: &[u8]) -> Vec<u8> {
    let mut out = vec![8];
    let (mut bits, mut used) = (0u32, 0u32);
    let mut put = |code: u16, width: u32, out: &mut Vec<u8>| {
        bits |= u32::from(code) << used;
        used += width;
        while used >= 8 {
            out.push(bits as u8);
            bits >>= 8;
            used -= 8;
        }
    };
    let mut child = vec![0u16; 4096 * 256];
    let (mut free, mut width) = (FIRST_FREE, 9);
    let Some((&first, rest)) = indices.split_first() else {
        return out;
    };
    put(CLEAR, width, &mut out);
    let mut code = u16::from(first);
    for &index in rest {
        let slot = usize::from(code) * 256 + usize::from(index);
        if child[slot] != 0 {
            code = child[slot];
            continue;
        }
        put(code, width, &mut out);
        if u32::from(free) >= 1 << width && width < 12 {
            width += 1;
        }
        if free < LAST_CODE {
            child[slot] = free;
            free += 1;
        } else {
            put(CLEAR, width, &mut out);
            child.fill(0);
            (free, width) = (FIRST_FREE, 9);
        }
        code = u16::from(index);
    }
    put(code, width, &mut out);
    put(END, width, &mut out);
    put(0, 7, &mut out);
    out
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

pub(super) fn compression(
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
    let codec = key(unsafe {
        if width.max(height) > 4096 {
            AVVideoCodecTypeHEVC
        } else {
            AVVideoCodecTypeH264
        }
    })?;
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
    fn lzw_decodes_back_to_the_same_pixels() {
        let indices: Vec<u8> = (0..60_000u32)
            .map(|i| ((i / 7 + i % 13 * 5) % 255) as u8)
            .collect();
        let mut file = Vec::new();
        let mut gif = Encoder::new(&mut file, 300, 200, &[]).unwrap();
        let frame = Frame {
            width: 300,
            height: 200,
            buffer: lzw(&indices).into(),
            palette: Some((0..=255u8).flat_map(|i| [i, i, i]).collect()),
            ..Frame::default()
        };
        gif.write_lzw_pre_encoded_frame(&frame).unwrap();
        drop(gif);
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::Indexed);
        let mut decoder = options.read_info(file.as_slice()).unwrap();
        assert_eq!(*decoder.read_next_frame().unwrap().unwrap().buffer, indices);
    }

    #[test]
    fn gif_frames_all_last_five_hundredths() {
        for fps in [25, 50] {
            let ends: Vec<i32> = (0..fps)
                .map(|frame| hundredths(f64::from(frame + 1) / f64::from(fps)))
                .collect();
            let delays: Vec<i32> = std::iter::once(ends[0])
                .chain(ends.windows(2).map(|pair| pair[1] - pair[0]))
                .collect();
            assert!(delays.iter().all(|&delay| delay == 100 / fps));
        }
    }
}
