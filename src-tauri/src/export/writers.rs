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
    AVMediaTypeVideo, AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoCodecTypeHEVC,
    AVVideoCompressionPropertiesKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalDurationKey,
    AVVideoQualityKey, AVVideoWidthKey,
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
    let mut gif = GifWriter::new(output, width, height, CLOSE_COLOR)?;
    let mut ends = 0;
    while let Some(sample) = unsafe { frames.copyNextSampleBuffer() } {
        let time = unsafe { sample.presentation_time_stamp() };
        let start = unsafe { time.seconds() };
        ends = hundredths(start + 1.0 / f64::from(frame_rate));
        let pixels = unsafe { sample.image_buffer() }.context("a frame had no picture")?;
        gif.push(&rgba(&pixels)?, hundredths(start))?;
        progress_at(time)?;
    }
    gif.finish(ends)
}

/// Writes frames as a GIF. Each frame holds only the pixels that changed, and frames are
/// compressed a batch at a time on every core.
struct GifWriter {
    gif: Encoder<BufWriter<File>>,
    width: usize,
    /// See `CLOSE_COLOR`.
    close: u8,
    /// The colors the GIF shows now.
    shown: Vec<u8>,
    /// The frame before this one, as it was meant to look.
    before: Vec<u8>,
    parts: Vec<Part>,
    /// The last frame, held until the next one starts, which sets how long it shows.
    held: Option<(Frame<'static>, i32)>,
    batch_size: usize,
}

impl GifWriter {
    fn new(output: &Path, width: u32, height: u32, close: u8) -> Result<Self> {
        let file = BufWriter::new(File::create(output).context("could not start the GIF")?);
        let mut gif = Encoder::new(file, width as u16, height as u16, &[])?;
        gif.set_repeat(Repeat::Infinite)?;
        Ok(Self {
            gif,
            width: width as usize,
            close,
            shown: Vec::new(),
            before: Vec::new(),
            parts: Vec::new(),
            held: None,
            batch_size: std::thread::available_parallelism().map_or(4, |cores| cores.get()),
        })
    }

    /// Adds the frame that shows from `start` hundredths of a second.
    fn push(&mut self, rgba: &[u8], start: i32) -> Result<()> {
        let (shown, before) = (&mut self.shown, &mut self.before);
        let close = self.close;
        (self.parts).extend(changed_part(rgba, shown, before, self.width, start, close));
        if self.parts.len() == self.batch_size {
            self.write_parts()?;
        }
        Ok(())
    }

    /// Turns the waiting parts into frames on every core, then writes them in order.
    /// `shown` then gets the colors each frame really shows, so a pixel drawn a few shades
    /// off is redrawn once it settles instead of staying behind as a ghost.
    fn write_parts(&mut self) -> Result<()> {
        let (parts, close) = (std::mem::take(&mut self.parts), self.close);
        let frames: Vec<(Frame, Vec<u8>)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (parts.iter())
                .map(|part| scope.spawn(move || part.frame(close)))
                .collect();
            (workers.into_iter())
                .map(|worker| worker.join().map_err(|_| anyhow!("a GIF frame failed"))?)
                .collect::<Result<_>>()
        })?;
        for ((next, indices), part) in frames.into_iter().zip(&parts) {
            let palette = next.palette.as_deref().unwrap_or_default();
            part.note_shown(&indices, palette, &mut self.shown, self.width);
            if let Some((mut frame, from)) = self.held.replace((next, part.start)) {
                frame.delay = (part.start - from) as u16;
                self.gif.write_lzw_pre_encoded_frame(&frame)?;
            }
        }
        Ok(())
    }

    /// Writes what's left; the last frame shows until `ends` hundredths of a second.
    fn finish(mut self, ends: i32) -> Result<()> {
        self.write_parts()?;
        if let Some((mut frame, from)) = self.held.take() {
            frame.delay = (ends - from) as u16;
            self.gif.write_lzw_pre_encoded_frame(&frame)?;
        }
        self.gif.into_inner()?.flush()?;
        Ok(())
    }
}

/// The frame's pixels as RGBA. Frames come from our compositor, which draws 32BGRA.
fn rgba(pixels: &CVPixelBuffer) -> Result<Vec<u8>> {
    let read_only = CVPixelBufferLockFlags::ReadOnly;
    // SAFETY: the buffer is alive for this call, and it's unlocked below on every path.
    let locked = unsafe { CVPixelBufferLockBaseAddress(pixels, read_only) };
    ensure!(locked == 0, "could not read a frame");
    let read = || {
        let row_bytes = CVPixelBufferGetBytesPerRow(pixels);
        let (width, height) = (
            CVPixelBufferGetWidth(pixels),
            CVPixelBufferGetHeight(pixels),
        );
        let base = CVPixelBufferGetBaseAddress(pixels).cast::<u8>();
        ensure!(
            !base.is_null() && row_bytes >= width * 4,
            "a frame had no pixels"
        );
        let mut rgba = Vec::with_capacity(width * height * 4);
        for row in 0..height {
            // SAFETY: the locked buffer holds `height` rows of `row_bytes`, each at least
            // `width * 4` bytes, as checked above.
            let bgra = unsafe { std::slice::from_raw_parts(base.add(row * row_bytes), width * 4) };
            rgba.extend(
                bgra.as_chunks::<4>()
                    .0
                    .iter()
                    .flat_map(|p| [p[2], p[1], p[0], 255]),
            );
        }
        Ok(rgba)
    };
    let rgba = read();
    // SAFETY: locked above with the same flags.
    unsafe { CVPixelBufferUnlockBaseAddress(pixels, read_only) };
    rgba
}

/// Pixels within this many shades of what's showing count as unchanged, so video noise
/// doesn't redraw the whole frame.
const SAME_COLOR: u8 = 3;
/// A pixel that's still changing may be drawn up to this many shades off, which keeps runs
/// of near-identical colors going and makes the file smaller. Once it stops changing it's
/// redrawn exactly, so nothing rough stays on screen. 0 draws every pixel exactly.
const CLOSE_COLOR: u8 = 10;
const SEE_THROUGH: u8 = 255;
/// Each frame's most common colors get exact palette slots. Without them a
/// flat background can come out a shade off in one frame and stay that way,
/// leaving faint ghosts where things moved.
const EXACT_COLORS: usize = 32;

/// How a part draws a pixel, kept in the pixel's alpha.
const KEPT: u8 = 0;
const EXACT: u8 = 254;
const CLOSE: u8 = 255;

/// The rectangle that changed since the last frame, starting at `start` hundredths of a
/// second. A pixel's alpha says how it's drawn: KEPT (left as it is), CLOSE (still changing,
/// so a nearby color will do) or EXACT.
struct Part {
    left: usize,
    top: usize,
    width: usize,
    rgba: Vec<u8>,
    start: i32,
}

/// Returns nothing when the frame matches what's showing, so the previous frame just stays
/// longer. `shown` holds the colors showing per pixel and `before` the previous frame.
fn changed_part(
    rgba: &[u8],
    shown: &mut Vec<u8>,
    before: &mut Vec<u8>,
    width: usize,
    start: i32,
    close: u8,
) -> Option<Part> {
    let is_first = shown.is_empty();
    if is_first {
        shown.extend_from_slice(rgba);
        before.extend_from_slice(rgba);
    }
    let off = |from: &[u8], i: usize| {
        let (a, b) = (&rgba[i * 4..i * 4 + 3], &from[i * 4..i * 4 + 3]);
        a[0].abs_diff(b[0])
            .max(a[1].abs_diff(b[1]))
            .max(a[2].abs_diff(b[2]))
    };
    let how: Vec<u8> = (0..rgba.len() / 4)
        .map(|i| {
            let wrong = off(shown, i);
            let is_moving = off(before, i) > SAME_COLOR;
            match () {
                () if is_first => EXACT,
                () if wrong <= SAME_COLOR => KEPT,
                () if !is_moving => EXACT,
                () if wrong > close => CLOSE,
                () => KEPT,
            }
        })
        .collect();
    before.copy_from_slice(rgba);
    let drawn = || (0..how.len()).filter(|&i| how[i] != KEPT);
    let (xs, ys) = (drawn().map(|i| i % width), drawn().map(|i| i / width));
    let (left, right) = (xs.clone().min()?, xs.max()?);
    let (top, bottom) = (ys.clone().min()?, ys.max()?);
    let part_width = right - left + 1;
    let mut part: Vec<u8> = (top..=bottom)
        .flat_map(|y| &rgba[(y * width + left) * 4..(y * width + right + 1) * 4])
        .copied()
        .collect();
    for (i, at) in (top..=bottom)
        .flat_map(|y| (left..=right).map(move |x| y * width + x))
        .enumerate()
    {
        part[i * 4 + 3] = how[at];
        if how[at] != KEPT {
            shown[at * 4..at * 4 + 3].copy_from_slice(&rgba[at * 4..at * 4 + 3]);
        }
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
    /// Picks a palette from the pixels this part draws and compresses it, ready to write,
    /// with the palette index each pixel got.
    fn frame(&self, close: u8) -> Result<(Frame<'static>, Vec<u8>)> {
        let pixels = self.rgba.as_chunks::<4>().0;
        let height = pixels.len() / self.width;
        let drawn: Vec<Srgb<u8>> = (pixels.iter())
            .filter(|p| p[3] != KEPT)
            .map(|p| Srgb::new(p[0], p[1], p[2]))
            .collect();
        let image = ImageRef::new(drawn.len() as u32, 1, drawn.as_slice())
            .map_err(|_| anyhow!("a GIF frame had the wrong size"))?;
        let mut counts = HashMap::<[u8; 3], u32>::new();
        for color in &drawn {
            *counts
                .entry([color.red, color.green, color.blue])
                .or_default() += 1;
        }
        let mut exact: Vec<([u8; 3], u32)> = counts.into_iter().collect();
        exact.sort_unstable_by_key(|&(color, count)| (std::cmp::Reverse(count), color));
        exact.truncate(EXACT_COLORS);
        let (rest, picked) = Pipeline::new()
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
        let mut picked = picked.into_iter();
        let mut indices: Vec<u8> = (pixels.iter())
            .map(|pixel| {
                if pixel[3] == KEPT {
                    return SEE_THROUGH;
                }
                let quantized = picked.next().unwrap_or(0) + exact.len() as u8;
                (slot.get(&[pixel[0], pixel[1], pixel[2]])).map_or(quantized, |&i| i)
            })
            .collect();
        let colors: Vec<[u8; 3]> = (exact.iter().map(|(color, _)| *color))
            .chain(rest.iter().map(|c| [c.red, c.green, c.blue]))
            .collect();
        let loose: Vec<bool> = pixels.iter().map(|p| p[3] == CLOSE).collect();
        let buffer = lzw(&mut indices, &near_colors(&colors, close), &loose);
        let mut palette: Vec<u8> = colors.into_iter().flatten().collect();
        palette.resize(256 * 3, 0);
        let frame = Frame {
            left: self.left as u16,
            top: self.top as u16,
            width: self.width as u16,
            height: height as u16,
            buffer: buffer.into(),
            palette: Some(palette),
            transparent: Some(SEE_THROUGH),
            dispose: DisposalMethod::Keep,
            ..Frame::default()
        };
        Ok((frame, indices))
    }

    /// Writes the palette colors this part shows into `shown` (RGBA, `width` wide).
    fn note_shown(&self, indices: &[u8], palette: &[u8], shown: &mut [u8], width: usize) {
        for (i, &index) in indices.iter().enumerate() {
            if index == SEE_THROUGH {
                continue;
            }
            let at = ((self.top + i / self.width) * width + self.left + i % self.width) * 4;
            let color = usize::from(index) * 3;
            shown[at..at + 3].copy_from_slice(&palette[color..color + 3]);
        }
    }
}

/// For each palette color, the others within `close` shades of it, nearest first.
fn near_colors(colors: &[[u8; 3]], close: u8) -> Vec<Vec<u8>> {
    if close == 0 {
        return Vec::new();
    }
    let apart = |a: [u8; 3], b: [u8; 3]| (0..3).map(|c| a[c].abs_diff(b[c])).max().unwrap_or(0);
    (colors.iter())
        .map(|&color| {
            let mut near: Vec<u8> = (0..colors.len())
                .filter(|&other| colors[other] != color && apart(color, colors[other]) <= close)
                .map(|other| other as u8)
                .collect();
            near.sort_unstable_by_key(|&other| apart(color, colors[usize::from(other)]));
            near
        })
        .collect()
}

const CLEAR: u16 = 256;
const END: u16 = 257;
const FIRST_FREE: u16 = 258;
const LAST_CODE: u16 = 4095;

/// GIF's LZW compression of 8-bit palette indices, as the code-size byte and
/// packed codes `write_lzw_pre_encoded_frame` expects. Output, widening and
/// clearing follow giflib's order, which compresses screen recordings about
/// 20% better than the `gif` crate's own encoder.
///
/// A `loose` pixel may take a `near` color instead of its own when that keeps a run already
/// in the dictionary going, which is what makes the file smaller. `indices` ends up holding
/// the colors that were written.
fn lzw(indices: &mut [u8], near: &[Vec<u8>], loose: &[bool]) -> Vec<u8> {
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
    let Some(&first) = indices.first() else {
        return out;
    };
    put(CLEAR, width, &mut out);
    let mut code = u16::from(first);
    for (at, written) in indices.iter_mut().enumerate().skip(1) {
        let index = *written;
        let row = usize::from(code) * 256;
        let slot = row + usize::from(index);
        if child[slot] != 0 {
            code = child[slot];
            continue;
        }
        let stand_in = (loose.get(at) == Some(&true))
            .then(|| near.get(usize::from(index)))
            .flatten()
            .and_then(|near| {
                near.iter()
                    .find(|&&other| child[row + usize::from(other)] != 0)
            });
        if let Some(&other) = stand_in {
            *written = other;
            code = child[row + usize::from(other)];
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

/// A keyframe holds a whole picture, and a screen full of text makes it a big one. One
/// every few seconds keeps files small and still lets players seek.
const KEYFRAME_EVERY_SECONDS: f64 = 4.0;

/// `quality` (0 to 1) is how close every frame stays to the original. The encoder spends
/// what that takes: almost nothing while the screen is still, more when it moves. A fixed
/// bitrate spent the same on both, which made screen recordings several times larger.
pub(super) fn compression(
    width: u32,
    height: u32,
    quality: f64,
) -> Result<Retained<NSDictionary<NSString, AnyObject>>> {
    let key =
        |key: Option<&'static NSString>| key.context("AVFoundation is missing a video setting");
    let quality = NSNumber::new_f64(quality);
    let keyframe_every = NSNumber::new_f64(KEYFRAME_EVERY_SECONDS);
    let compression = NSDictionary::<NSString, NSNumber>::from_slices(
        &[
            key(unsafe { AVVideoQualityKey })?,
            key(unsafe { AVVideoMaxKeyFrameIntervalDurationKey })?,
        ],
        &[&quality, &keyframe_every],
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
    fn a_part_should_record_the_palette_colors_it_really_shows() {
        let part = Part {
            left: 1,
            top: 1,
            width: 2,
            rgba: vec![0; 2 * 4],
            start: 0,
        };
        let mut shown = vec![50; 3 * 2 * 4];
        let palette = [10, 20, 30, 200, 210, 220];
        part.note_shown(&[1, SEE_THROUGH], &palette, &mut shown, 3);
        let pixel = |x: usize, y: usize| &shown[(y * 3 + x) * 4..(y * 3 + x) * 4 + 4];
        assert_eq!(pixel(1, 1), [200, 210, 220, 50]);
        assert_eq!(pixel(2, 1), [50, 50, 50, 50]);
        assert_eq!(pixel(0, 0), [50, 50, 50, 50]);
    }

    /// One row of gray pixels, to feed `changed_part`.
    fn grays(levels: &[u8]) -> Vec<u8> {
        levels.iter().flat_map(|&v| [v, v, v, 255]).collect()
    }

    #[test]
    fn a_moving_pixel_may_lag_a_little_but_a_settled_one_is_drawn_exactly() {
        let (mut shown, mut before) = (Vec::new(), Vec::new());
        let how = |part: Option<Part>| {
            part.map(|part| {
                part.rgba
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|p| p[3])
                    .collect::<Vec<_>>()
            })
        };
        let first = changed_part(&grays(&[100, 100, 100]), &mut shown, &mut before, 3, 0, 10);
        assert_eq!(how(first), Some(vec![EXACT; 3]));
        // Pixel 0 jumps far (drawn), pixel 1 moves 8 shades (close enough to leave), pixel 2 is noise.
        let moved = changed_part(&grays(&[160, 108, 102]), &mut shown, &mut before, 3, 3, 10);
        assert_eq!(how(moved), Some(vec![CLOSE]));
        // Nothing moves now, so the pixel left 8 shades off is drawn exactly.
        let settled = changed_part(&grays(&[160, 108, 102]), &mut shown, &mut before, 3, 6, 10);
        assert_eq!(how(settled), Some(vec![EXACT]));
        assert!(
            changed_part(&grays(&[160, 108, 102]), &mut shown, &mut before, 3, 9, 10).is_none()
        );
    }

    #[test]
    fn lzw_decodes_back_to_the_same_pixels() {
        let mut indices: Vec<u8> = (0..60_000u32)
            .map(|i| ((i / 7 + i % 13 * 5) % 255) as u8)
            .collect();
        let wanted = indices.clone();
        let mut file = Vec::new();
        let mut gif = Encoder::new(&mut file, 300, 200, &[]).unwrap();
        let frame = Frame {
            width: 300,
            height: 200,
            buffer: lzw(&mut indices, &[], &[]).into(),
            palette: Some((0..=255u8).flat_map(|i| [i, i, i]).collect()),
            ..Frame::default()
        };
        gif.write_lzw_pre_encoded_frame(&frame).unwrap();
        drop(gif);
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::Indexed);
        let mut decoder = options.read_info(file.as_slice()).unwrap();
        assert_eq!(*decoder.read_next_frame().unwrap().unwrap().buffer, wanted);
    }

    #[test]
    fn loose_pixels_take_near_colors_and_the_file_decodes_to_what_was_written() {
        let grays: Vec<[u8; 3]> = (0..=254u8).map(|v| [v, v, v]).collect();
        let near = near_colors(&grays, 4);
        let mut indices: Vec<u8> = (0..60_000u32)
            .map(|i| (100 + (i * 7 + i / 300) % 5) as u8)
            .collect();
        let wanted = indices.clone();
        let exact = lzw(&mut wanted.clone(), &[], &[]).len();
        let loose = vec![true; indices.len()];
        let buffer = lzw(&mut indices, &near, &loose);
        assert!(buffer.len() < exact, "{} vs {exact}", buffer.len());
        assert!(
            indices
                .iter()
                .zip(&wanted)
                .all(|(got, want)| got.abs_diff(*want) <= 4)
        );
        let mut file = Vec::new();
        let mut gif = Encoder::new(&mut file, 300, 200, &[]).unwrap();
        let frame = Frame {
            width: 300,
            height: 200,
            buffer: buffer.into(),
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

    /// Re-encodes a GIF with this writer to compare sizes: GIF_TEST_INPUT, GIF_TEST_OUTPUT,
    /// and optionally GIF_TEST_CLOSE (shades) and GIF_TEST_EVERY (keep every nth frame).
    #[test]
    #[ignore = "needs a real GIF"]
    fn rewrites_a_gif_to_compare_sizes() {
        let var = |name: &str, or: &str| std::env::var(name).unwrap_or(or.into());
        let (input, output) = (var("GIF_TEST_INPUT", ""), var("GIF_TEST_OUTPUT", ""));
        let close: u8 = var("GIF_TEST_CLOSE", "10").parse().unwrap();
        let every: usize = var("GIF_TEST_EVERY", "1").parse().unwrap();
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::RGBA);
        let mut decoder = options.read_info(File::open(&input).unwrap()).unwrap();
        let (width, height) = (usize::from(decoder.width()), usize::from(decoder.height()));
        let mut canvas = vec![0u8; width * height * 4];
        let mut writer =
            GifWriter::new(Path::new(&output), width as u32, height as u32, close).unwrap();
        let started = std::time::Instant::now();
        let (mut at, mut count) = (0i32, 0usize);
        while let Some(frame) = decoder.read_next_frame().unwrap() {
            let (left, top) = (usize::from(frame.left), usize::from(frame.top));
            for (i, pixel) in frame.buffer.as_chunks::<4>().0.iter().enumerate() {
                if pixel[3] != 0 {
                    let x = left + i % usize::from(frame.width);
                    let y = top + i / usize::from(frame.width);
                    canvas[(y * width + x) * 4..(y * width + x) * 4 + 4].copy_from_slice(pixel);
                }
            }
            if count % every == 0 {
                writer.push(&canvas, at).unwrap();
            }
            count += 1;
            at += i32::from(frame.delay);
        }
        writer.finish(at).unwrap();
        let megabytes = std::fs::metadata(&output).unwrap().len() as f64 / 1e6;
        println!(
            "close {close}, every {every}: {megabytes:.1} MB from {count} frames in {:.1}s",
            started.elapsed().as_secs_f64()
        );
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
