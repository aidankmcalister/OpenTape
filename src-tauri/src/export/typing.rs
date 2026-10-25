use std::path::Path;

use anyhow::{Result, ensure};
use objc2_av_foundation::{AVAssetImageGenerator, AVURLAsset};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapContextGetBytesPerRow, CGBitmapContextGetData, CGContext, CGImage,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{cutout::canvas, file_url, seconds};

const WIDTH: f64 = 320.0;
const STEP_S: f64 = 0.5;
const CHANGED: u8 = 24;
const MOST_CHANGED: f64 = 0.15;
const CELL: usize = 16;

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct TypingStretch {
    start: f64,
    end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct TypingSpot {
    t: f64,
    x: f64,
    y: f64,
}

pub(crate) fn typing_spots(video: &Path, stretches: &[TypingStretch]) -> Result<Vec<TypingSpot>> {
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&file_url(video), None) };
    let frames = unsafe { AVAssetImageGenerator::assetImageGeneratorWithAsset(&asset) };
    unsafe {
        frames.setAppliesPreferredTrackTransform(true);
        frames.setMaximumSize(CGSize::new(WIDTH, WIDTH * 4.0));
        frames.setRequestedTimeToleranceBefore(seconds(0.05));
        frames.setRequestedTimeToleranceAfter(seconds(0.05));
    }
    let mut spots = Vec::new();
    for stretch in stretches {
        let mut before: Option<(Vec<u8>, usize)> = None;
        let mut t = (stretch.start - STEP_S).max(0.0);
        while t <= stretch.end + STEP_S {
            #[allow(deprecated)]
            let image = unsafe {
                frames.copyCGImageAtTime_actualTime_error(seconds(t), std::ptr::null_mut())
            };
            if let Ok(image) = image {
                let now = brightness(&image)?;
                if let Some((x, y)) = before
                    .as_ref()
                    .and_then(|(past, width)| changed_spot(past, &now.0, *width))
                {
                    spots.push(TypingSpot { t, x, y });
                }
                before = Some(now);
            }
            t += STEP_S;
        }
    }
    Ok(spots)
}

fn brightness(image: &CGImage) -> Result<(Vec<u8>, usize)> {
    let (width, height) = (CGImage::width(Some(image)), CGImage::height(Some(image)));
    let (_, context) = canvas(width, height)?;
    let whole = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(width as f64, height as f64),
    );
    CGContext::draw_image(Some(&context), whole, Some(image));
    let data = CGBitmapContextGetData(Some(&context)).cast::<u8>();
    ensure!(!data.is_null(), "could not read a frame");
    let row = CGBitmapContextGetBytesPerRow(Some(&context));
    let bytes = unsafe { std::slice::from_raw_parts(data, row * height) };
    let levels = (0..height)
        .flat_map(|y| {
            (0..width).map(move |x| {
                let at = y * row + x * 4;
                let [r, g, b] = [bytes[at], bytes[at + 1], bytes[at + 2]].map(u32::from);
                ((3 * r + 6 * g + b) / 10) as u8
            })
        })
        .collect();
    Ok((levels, width))
}

fn changed_spot(before: &[u8], after: &[u8], width: usize) -> Option<(f64, f64)> {
    if before.len() != after.len() || width == 0 {
        return None;
    }
    let height = after.len() / width;
    let columns = width.div_ceil(CELL);
    let mut cells = vec![0usize; columns * height.div_ceil(CELL)];
    let changed: Vec<usize> = (0..after.len())
        .filter(|&at| before[at].abs_diff(after[at]) > CHANGED)
        .collect();
    if changed.len() < 3 || changed.len() as f64 > after.len() as f64 * MOST_CHANGED {
        return None;
    }
    let cell_of = |at: usize| (at / width / CELL) * columns + (at % width) / CELL;
    for &at in &changed {
        cells[cell_of(at)] += 1;
    }
    let busiest = (0..cells.len()).max_by_key(|&cell| cells[cell])?;
    let (row, column) = (busiest / columns, busiest % columns);
    let near: Vec<usize> = changed
        .into_iter()
        .filter(|&at| {
            let cell = cell_of(at);
            (cell / columns).abs_diff(row) <= 1 && (cell % columns).abs_diff(column) <= 1
        })
        .collect();
    let count = near.len() as f64;
    let x = near.iter().map(|at| (at % width) as f64).sum::<f64>() / count;
    let y = near.iter().map(|at| (at / width) as f64).sum::<f64>() / count;
    Some(((x + 0.5) / width as f64, (y + 0.5) / height as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spot_is_where_a_few_pixels_changed_and_nothing_when_most_did() {
        let before = vec![0u8; 100];
        let mut typed = before.clone();
        for at in [12, 13, 22, 23] {
            typed[at] = 200;
        }
        assert_eq!(changed_spot(&before, &typed, 10), Some((0.3, 0.2)));
        assert_eq!(changed_spot(&before, &before, 10), None);
        assert_eq!(changed_spot(&before, &[200u8; 100], 10), None);
    }

    #[test]
    fn the_spot_follows_the_busiest_change_and_ignores_a_change_elsewhere() {
        let (width, height) = (128, 64);
        let before = vec![0u8; width * height];
        let mut after = before.clone();
        for y in 6..10 {
            for x in 100..120 {
                after[y * width + x] = 200;
            }
        }
        for y in 50..53 {
            for x in 10..14 {
                after[y * width + x] = 200;
            }
        }
        let (x, y) = changed_spot(&before, &after, width).unwrap();
        assert!((x - 110.0 / 128.0).abs() < 0.02, "{x}");
        assert!((y - 8.0 / 64.0).abs() < 0.02, "{y}");
    }

    #[test]
    #[ignore = "needs a real video"]
    fn finds_typing_in_a_real_recording() {
        let video = std::env::var("TYPING_TEST_VIDEO").expect("TYPING_TEST_VIDEO");
        let [start, end] = ["TYPING_TEST_START", "TYPING_TEST_END"]
            .map(|name| std::env::var(name).expect(name).parse().unwrap());
        let spots = typing_spots(Path::new(&video), &[TypingStretch { start, end }]).unwrap();
        for spot in &spots {
            println!("{:.1}s at {:.2}, {:.2}", spot.t, spot.x, spot.y);
        }
        assert!(!spots.is_empty());
    }
}
