use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use objc2::rc::Retained;
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGBitmapContextCreateImage, CGColor, CGContext};
use objc2_core_image::CIImage;
use serde::Deserialize;
use ts_rs::TS;

use super::PixelRect;
use super::cutout::{canvas, rgb};

const RING_SECONDS: f64 = 0.5;
const RING_STEPS: f64 = 60.0;
const KEPT_PICTURES: usize = 600;

pub(super) type RingPictures = Mutex<HashMap<(RingStyle, String, u64, u32), Retained<CIImage>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum RingStyle {
    Ring,
    Pulse,
    Ripple,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportRing {
    pub(super) t: f64,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) color: String,
    pub(super) size: f64,
    pub(super) style: RingStyle,
}

#[derive(Debug, PartialEq)]
pub(super) struct Circle {
    pub(super) radius: f64,
    pub(super) alpha: f64,
    pub(super) is_filled: bool,
}

pub(super) fn circles(style: RingStyle, progress: f64, size: f64) -> Vec<Circle> {
    let ring = |at: f64| Circle {
        radius: size / 2.0 * (0.4 + 0.6 * at),
        alpha: 1.0 - at,
        is_filled: false,
    };
    match style {
        RingStyle::Ring => vec![ring(progress)],
        RingStyle::Pulse => vec![Circle {
            radius: size / 2.0 * (0.3 + 0.7 * progress),
            alpha: 0.5 * (1.0 - progress),
            is_filled: true,
        }],
        RingStyle::Ripple => [progress, progress - 0.3]
            .into_iter()
            .filter(|at| *at >= 0.0)
            .map(ring)
            .collect(),
    }
}

impl ExportRing {
    pub(super) fn is_showing(&self, now: f64) -> bool {
        (0.0..RING_SECONDS).contains(&(now - self.t))
    }

    pub(super) fn image(
        &self,
        now: f64,
        video: &PixelRect,
        zoom_scale: f64,
        height: u32,
        pictures: &RingPictures,
    ) -> Result<Retained<CIImage>> {
        let size = (self.size * zoom_scale).round();
        let center = (size + 8.0).ceil() / 2.0;
        let step = ((now - self.t) / RING_SECONDS * RING_STEPS).round() as u32;
        let key = (self.style, self.color.clone(), size as u64, step);
        let mut pictures = pictures
            .lock()
            .map_err(|_| anyhow!("could not reuse a click ring"))?;
        let picture = match pictures.get(&key) {
            Some(picture) => picture.clone(),
            None => {
                if pictures.len() >= KEPT_PICTURES {
                    pictures.clear();
                }
                let picture = self.picture(size, f64::from(step) / RING_STEPS)?;
                pictures.insert(key, picture.clone());
                picture
            }
        };
        let move_to = CGAffineTransform {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            tx: video.x + self.x * video.width - center,
            ty: f64::from(height) - (video.y + self.y * video.height) - center,
        };
        Ok(unsafe { picture.imageByApplyingTransform(move_to) })
    }

    fn picture(&self, size: f64, progress: f64) -> Result<Retained<CIImage>> {
        let side = (size + 8.0).ceil();
        let center = side / 2.0;
        let [red, green, blue] = rgb(&self.color)?;
        let (_, context) = canvas(side as usize, side as usize)?;
        let context = Some(&*context);
        CGContext::set_line_width(context, (size * 0.08).max(2.0));
        for circle in circles(self.style, progress, size) {
            let color = CGColor::new_srgb(red, green, blue, circle.alpha);
            let rect = CGRect::new(
                CGPoint::new(center - circle.radius, center - circle.radius),
                CGSize::new(circle.radius * 2.0, circle.radius * 2.0),
            );
            if circle.is_filled {
                CGContext::set_fill_color_with_color(context, Some(&color));
                CGContext::fill_ellipse_in_rect(context, rect);
            } else {
                CGContext::set_stroke_color_with_color(context, Some(&color));
                CGContext::stroke_ellipse_in_rect(context, rect);
            }
        }
        let image = CGBitmapContextCreateImage(context).context("could not finish a click ring")?;
        Ok(unsafe { CIImage::imageWithCGImage(&image) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ring_grows_and_fades_and_a_ripple_sends_a_second_one_after_it() {
        assert_eq!(
            circles(RingStyle::Ring, 0.0, 100.0),
            [Circle {
                radius: 20.0,
                alpha: 1.0,
                is_filled: false
            }]
        );
        assert_eq!(circles(RingStyle::Ring, 1.0, 100.0)[0].radius, 50.0);
        assert_eq!(circles(RingStyle::Ripple, 0.2, 100.0).len(), 1);
        assert_eq!(circles(RingStyle::Ripple, 0.5, 100.0).len(), 2);
        assert!(circles(RingStyle::Pulse, 0.0, 100.0)[0].is_filled);
    }

    #[test]
    fn a_ring_shows_for_half_a_second_from_its_click() {
        let ring = ExportRing {
            t: 2.0,
            x: 0.5,
            y: 0.5,
            color: "#ffffff".into(),
            size: 48.0,
            style: RingStyle::Ring,
        };
        assert!(!ring.is_showing(1.99));
        assert!(ring.is_showing(2.0));
        assert!(ring.is_showing(2.49));
        assert!(!ring.is_showing(2.5));
    }

    #[test]
    fn rings_at_the_same_step_and_size_share_one_picture() {
        let ring = |t: f64| ExportRing {
            t,
            x: 0.5,
            y: 0.5,
            color: "#ffffff".into(),
            size: 48.0,
            style: RingStyle::Ripple,
        };
        let video = PixelRect {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
        };
        let pictures = RingPictures::default();
        let count = || pictures.lock().unwrap().len();
        ring(1.0).image(1.2, &video, 1.0, 100, &pictures).unwrap();
        ring(3.001).image(3.2, &video, 1.0, 100, &pictures).unwrap();
        assert_eq!(count(), 1);
        ring(1.0).image(1.25, &video, 1.0, 100, &pictures).unwrap();
        assert_eq!(count(), 2);
        ring(1.0).image(1.25, &video, 2.0, 100, &pictures).unwrap();
        assert_eq!(count(), 3);
        ring(1.0)
            .image(1.25, &video, 2.004, 100, &pictures)
            .unwrap();
        assert_eq!(count(), 3);
    }
}
