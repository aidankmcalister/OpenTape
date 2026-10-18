//! Points and rectangles, and the conversions between them. Pages, ScreenCaptureKit and the
//! cursor measure from the top-left; AppKit windows, views and screens from the bottom-left.

use cidre::cg;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A spot in points. The picker's cursor is in global points, top-left origin, like the window
/// and display frames.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub(crate) struct Point {
    pub x: f64,
    pub y: f64,
}

/// A rectangle in points, as the frontend sends and receives it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub(crate) struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Frame {
    /// Whether `point` is inside. Both must be measured from the same corner.
    pub(crate) fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.x < self.x + self.width
            && point.y >= self.y
            && point.y < self.y + self.height
    }
}

impl From<cg::Rect> for Frame {
    fn from(rect: cg::Rect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

impl From<NSRect> for Frame {
    fn from(rect: NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

impl From<Frame> for NSRect {
    fn from(frame: Frame) -> Self {
        NSRect::new(
            NSPoint::new(frame.x, frame.y),
            NSSize::new(frame.width, frame.height),
        )
    }
}

impl From<NSPoint> for Point {
    fn from(point: NSPoint) -> Self {
        Self {
            x: point.x,
            y: point.y,
        }
    }
}

/// Flips a rectangle between top-left and bottom-left measuring, inside a space `height` tall.
/// The same sum works in both directions.
pub(crate) fn flip(rect: NSRect, height: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(rect.origin.x, height - rect.origin.y - rect.size.height),
        rect.size,
    )
}

/// A spot in a window (bottom-left origin) as a spot on its page (top-left origin), if it's
/// inside the window.
pub(crate) fn page_point(pointer: NSPoint, size: NSSize) -> Option<Point> {
    let is_inside =
        (0.0..size.width).contains(&pointer.x) && (0.0..size.height).contains(&pointer.y);
    is_inside.then_some(Point {
        x: pointer.x,
        y: size.height - pointer.y,
    })
}

/// `frame` resized to `size`, keeping its bottom middle in place.
pub(crate) fn keep_bottom_center(frame: NSRect, size: NSSize) -> NSRect {
    NSRect::new(
        NSPoint::new(
            frame.origin.x + (frame.size.width - size.width) / 2.0,
            frame.origin.y,
        ),
        size,
    )
}

/// Global screen rectangle to one relative to the display, which `src_rect` expects.
pub(crate) fn relative_to(rect: cg::Rect, display_frame: cg::Rect) -> cg::Rect {
    let mut relative = rect;
    relative.origin.x -= display_frame.origin.x;
    relative.origin.y -= display_frame.origin.y;
    relative
}

/// Display-relative rectangle back to global screen points.
pub(crate) fn on_screen(rect: cg::Rect, display_frame: cg::Rect) -> cg::Rect {
    let mut global = rect;
    global.origin.x += display_frame.origin.x;
    global.origin.y += display_frame.origin.y;
    global
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_should_find_the_screen_under_the_pointer() {
        let laptop = Frame::from(NSRect::new(
            NSPoint::new(0.0, 80.0),
            NSSize::new(1512.0, 869.0),
        ));
        let monitor = Frame::from(NSRect::new(
            NSPoint::new(1512.0, 0.0),
            NSSize::new(1920.0, 1080.0),
        ));
        let pointer = Point::from(NSPoint::new(2000.0, 500.0));
        assert!(monitor.contains(pointer));
        assert!(!laptop.contains(pointer));
    }

    #[test]
    fn flip_should_flip_a_top_left_rect() {
        let rect = NSRect::new(NSPoint::new(10.0, 20.0), NSSize::new(100.0, 40.0));
        assert_eq!(flip(rect, 800.0).origin.y, 740.0);
    }

    #[test]
    fn page_point_should_measure_from_the_top_left() {
        let size = NSSize::new(360.0, 225.0);
        let point = page_point(NSPoint::new(20.0, 200.0), size);
        assert_eq!(point, Some(Point { x: 20.0, y: 25.0 }));
        assert_eq!(page_point(NSPoint::new(400.0, 10.0), size), None);
    }

    #[test]
    fn keep_bottom_center_should_resize_around_the_bottom_middle() {
        let frame = NSRect::new(NSPoint::new(100.0, 90.0), NSSize::new(600.0, 58.0));
        let resized = keep_bottom_center(frame, NSSize::new(800.0, 58.0));
        assert_eq!((resized.origin.x, resized.origin.y), (0.0, 90.0));
    }

    #[test]
    fn relative_and_on_screen_should_undo_each_other() {
        let rect = cg::Rect::new(1700.0, 300.0, 920.0, 436.0);
        let display = cg::Rect::new(1512.0, -200.0, 1920.0, 1080.0);
        assert_eq!(on_screen(relative_to(rect, display), display), rect);
    }
}
