use anyhow::{Context, Result};
use base64::Engine;
use objc2::rc::Retained;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGBitmapContextCreateImage, CGColor, CGContext, CGImage};
use objc2_core_image::{CIContext, CIImage};
use objc2_foundation::NSData;
use serde::Deserialize;
use ts_rs::TS;

use super::PixelRect;
use super::cutout::{canvas, moved};
use crate::macos::cursor::CursorImage;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct CursorPoint {
    t: f64,
    x: f64,
    y: f64,
    angle: f64,
    alpha: f64,
    scale: f64,
    image: u32,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct ExportCursor {
    pub(super) points: Vec<CursorPoint>,
    pub(super) images: Vec<CursorImage>,
    pub(super) unit: f64,
    pub(super) dot: f64,
}

pub(super) struct Pictures(Vec<Retained<CGImage>>);

impl ExportCursor {
    pub(super) fn pictures(&self) -> Result<Pictures> {
        let context = unsafe { CIContext::context() };
        let pictures = self
            .images
            .iter()
            .map(|image| {
                let png = base64::engine::general_purpose::STANDARD.decode(&image.png)?;
                let source = unsafe { CIImage::imageWithData(&NSData::with_bytes(&png)) }
                    .context("could not read a cursor picture")?;
                unsafe { context.createCGImage_fromRect(&source, source.extent()) }
                    .context("could not draw a cursor picture")
            })
            .collect::<Result<_>>()?;
        Ok(Pictures(pictures))
    }

    pub(super) fn at(&self, now: f64) -> Option<CursorPoint> {
        let after = self.points.partition_point(|point| point.t <= now);
        let Some(next) = self.points.get(after) else {
            return self.points.last().copied();
        };
        let Some(before) = after.checked_sub(1).map(|at| self.points[at]) else {
            return Some(*next);
        };
        let share = ((now - before.t) / (next.t - before.t)).clamp(0.0, 1.0);
        let mix = |a: f64, b: f64| a + (b - a) * share;
        Some(CursorPoint {
            t: now,
            x: mix(before.x, next.x),
            y: mix(before.y, next.y),
            angle: mix(before.angle, next.angle),
            alpha: mix(before.alpha, next.alpha),
            scale: mix(before.scale, next.scale),
            image: if share < 0.5 {
                before.image
            } else {
                next.image
            },
        })
    }

    pub(super) fn image(
        &self,
        now: f64,
        video: &PixelRect,
        height: u32,
        pictures: &Pictures,
    ) -> Result<Option<Retained<CIImage>>> {
        let Some(point) = self.at(now) else {
            return Ok(None);
        };
        let tip_x = video.x + point.x * video.width;
        let tip_y = video.y + point.y * video.height;
        if point.alpha <= 0.0 {
            return Ok(None);
        }
        let px = self.unit * video.width * point.scale;
        let (hot, image) = if self.dot > 0.0 {
            self.dot_image(px, point.alpha)?
        } else {
            self.picture_image(&point, px, pictures)?
        };
        let image = unsafe { CIImage::imageWithCGImage(&image) };
        Ok(Some(moved(
            &image,
            tip_x - hot.x,
            f64::from(height) - tip_y - hot.y,
        )))
    }

    fn picture_image(
        &self,
        point: &CursorPoint,
        px: f64,
        pictures: &Pictures,
    ) -> Result<(CGPoint, Retained<CGImage>)> {
        let index = point.image as usize;
        let image = self
            .images
            .get(index)
            .context("a cursor picture is missing")?;
        let picture = pictures
            .0
            .get(index)
            .context("a cursor picture is missing")?;
        let (sin, cos) = point.angle.to_radians().sin_cos();
        let corners = [
            (-image.hot_x, -image.hot_y),
            (image.width - image.hot_x, -image.hot_y),
            (-image.hot_x, image.height - image.hot_y),
            (image.width - image.hot_x, image.height - image.hot_y),
        ]
        .map(|(x, y)| (x * cos - y * sin, x * sin + y * cos));
        let low_x = corners.iter().map(|at| at.0).fold(f64::MAX, f64::min);
        let high_x = corners.iter().map(|at| at.0).fold(f64::MIN, f64::max);
        let low_y = corners.iter().map(|at| at.1).fold(f64::MAX, f64::min);
        let high_y = corners.iter().map(|at| at.1).fold(f64::MIN, f64::max);
        let pad = 2.0;
        let wide = ((high_x - low_x) * px + 2.0 * pad).ceil();
        let tall = ((high_y - low_y) * px + 2.0 * pad).ceil();
        let (_, context) = canvas(wide as usize, tall as usize)?;
        let context = Some(&*context);
        let hot = CGPoint::new(pad - low_x * px, tall - pad + low_y * px);
        CGContext::set_alpha(context, point.alpha);
        CGContext::translate_ctm(context, hot.x, hot.y);
        CGContext::rotate_ctm(context, -point.angle.to_radians());
        CGContext::scale_ctm(context, px, px);
        let at = CGRect::new(
            CGPoint::new(-image.hot_x, image.hot_y - image.height),
            CGSize::new(image.width, image.height),
        );
        CGContext::draw_image(context, at, Some(picture));
        let drawn = CGBitmapContextCreateImage(context).context("could not finish the cursor")?;
        Ok((hot, drawn.into()))
    }

    fn dot_image(&self, px: f64, alpha: f64) -> Result<(CGPoint, Retained<CGImage>)> {
        let diameter = self.dot * px;
        let line = diameter * 0.06;
        let side = (diameter + 4.0).ceil();
        let (_, context) = canvas(side as usize, side as usize)?;
        let context = Some(&*context);
        let ring = CGRect::new(
            CGPoint::new(
                (side - diameter + line) / 2.0,
                (side - diameter + line) / 2.0,
            ),
            CGSize::new(diameter - line, diameter - line),
        );
        CGContext::set_alpha(context, alpha);
        CGContext::set_fill_color_with_color(
            context,
            Some(&CGColor::new_srgb(0.1, 0.1, 0.1, 0.55)),
        );
        CGContext::fill_ellipse_in_rect(context, ring);
        CGContext::set_stroke_color_with_color(
            context,
            Some(&CGColor::new_srgb(1.0, 1.0, 1.0, 0.9)),
        );
        CGContext::set_line_width(context, line);
        CGContext::stroke_ellipse_in_rect(context, ring);
        let drawn = CGBitmapContextCreateImage(context).context("could not finish the cursor")?;
        Ok((CGPoint::new(side / 2.0, side / 2.0), drawn.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(t: f64, x: f64, alpha: f64, image: u32) -> CursorPoint {
        CursorPoint {
            t,
            x,
            y: 0.5,
            angle: 0.0,
            alpha,
            scale: 1.0,
            image,
        }
    }

    #[test]
    fn the_cursor_moves_in_a_straight_line_between_points_and_holds_at_the_ends() {
        let cursor = ExportCursor {
            points: vec![point(1.0, 0.2, 1.0, 0), point(2.0, 0.6, 0.0, 2)],
            images: vec![],
            unit: 0.001,
            dot: 0.0,
        };
        let middle = cursor.at(1.5).unwrap();
        assert!((middle.x - 0.4).abs() < 1e-9);
        assert!((middle.alpha - 0.5).abs() < 1e-9);
        assert_eq!(cursor.at(1.4).unwrap().image, 0);
        assert_eq!(cursor.at(1.6).unwrap().image, 2);
        assert_eq!(cursor.at(0.0).unwrap().x, 0.2);
        assert_eq!(cursor.at(3.0).unwrap().x, 0.6);
    }
}
