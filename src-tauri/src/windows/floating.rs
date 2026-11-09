use std::sync::Mutex;
use std::time::{Duration, Instant};

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSCursor, NSEvent, NSPopUpMenuWindowLevel,
    NSScreen, NSWindow,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::CAMediaTimingFunction;
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

use crate::geometry::{Frame, Point, page_point};
use crate::util::{Poller, lock};
use crate::{PageEvent, macos};

const POINTER_CHECK_EVERY: Duration = Duration::from_millis(33);
const EDGE_GAP: f64 = 12.0;
/// A thrown window travels on this long before the nearest corner is picked.
const THROW_SECONDS: f64 = 0.2;
/// Samples older than this say nothing about how fast the window was thrown.
const FRESH_SECONDS: f64 = 0.1;
const GLIDE_SECONDS: f64 = 0.4;
/// Ease out with a slight overshoot, so the window settles into its corner.
const GLIDE_EASE: [f32; 4] = [0.3, 1.2, 0.5, 1.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Anchor {
    BottomCenter,
    BottomLeft,
    BottomRight,
    TopLeft,
    TopRight,
}

pub(crate) struct Behavior {
    pub label: &'static str,
    pub anchor: Anchor,
    pub keeps_its_spot: bool,
    /// Dragged and let go, the window glides to the nearest screen corner and stays there.
    pub snaps_to_corners: bool,
    pub on_pointer: fn(&NSWindow),
    pub hover: Option<Hover>,
}

pub(crate) struct Hover {
    pub event: fn(Option<Point>) -> PageEvent,
    pub on_enter_or_leave: fn(&AppHandle, bool),
}

pub(crate) struct Floating {
    window: Behavior,
    pointer_loop: Poller,
    reported: Mutex<Option<Point>>,
    spot: Mutex<Option<Spot>>,
    corner: Mutex<Option<Anchor>>,
    drag: Mutex<Option<Drag>>,
}

/// The last two places a window was dragged through, to tell how fast it was thrown.
#[derive(Debug, Clone, Copy)]
struct Drag {
    before: (Instant, NSPoint),
    last: (Instant, NSPoint),
}

impl Drag {
    fn velocity(self, now: Instant) -> NSPoint {
        let (before_at, before) = self.before;
        let (last_at, last) = self.last;
        let step = last_at.duration_since(before_at).as_secs_f64();
        let is_fresh = now.duration_since(last_at).as_secs_f64() <= FRESH_SECONDS;
        if !is_fresh || step <= 0.0 || step > FRESH_SECONDS {
            return NSPoint::new(0.0, 0.0);
        }
        NSPoint::new((last.x - before.x) / step, (last.y - before.y) / step)
    }
}

/// Where someone dragged a window that keeps its spot: its screen and its bottom center.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Spot {
    screen: NSRect,
    bottom_center: NSPoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PointerNews {
    Same,
    Moved,
    Entered,
    Left,
}

impl Floating {
    pub(crate) const fn new(window: Behavior) -> Self {
        Self {
            window,
            pointer_loop: Poller::new(),
            reported: Mutex::new(None),
            spot: Mutex::new(None),
            corner: Mutex::new(None),
            drag: Mutex::new(None),
        }
    }

    pub(crate) fn setup(&'static self, window: &WebviewWindow) -> tauri::Result<()> {
        super::never_close(window);
        if self.window.keeps_its_spot || self.window.snaps_to_corners {
            let moved = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Moved(_)) {
                    let _ = macos::with_ns_window(&moved, |ns_window| self.note_move(ns_window));
                }
            });
        }
        macos::with_ns_window(window, |ns_window| {
            macos::float_panel(ns_window, NSPopUpMenuWindowLevel);
        })
    }

    pub(crate) fn show(&'static self, app: &AppHandle) {
        self.show_on(app, false);
    }

    pub(crate) fn show_on_main_display(&'static self, app: &AppHandle) {
        self.show_on(app, true);
    }

    fn show_on(&'static self, app: &AppHandle, main_display: bool) {
        let Some(window) = app.get_webview_window(self.window.label) else {
            return;
        };
        let anchor = self.anchor();
        let _ = macos::with_ns_window(&window, move |ns_window| {
            let main_thread = ns_window.mtm();
            if main_display {
                if let Some(main) = NSScreen::screens(main_thread).firstObject() {
                    place(ns_window, &main, anchor);
                }
            } else if self.window.keeps_its_spot {
                if !self.return_to_spot(ns_window) {
                    follow_pointer(ns_window, anchor);
                }
            } else if let Some(screen) = screen_under_pointer(main_thread) {
                place(ns_window, &screen, anchor);
            }
            ns_window.orderFrontRegardless();
        });
        self.watch_pointer(window);
    }

    pub(crate) fn hide(&'static self, app: &AppHandle) {
        self.pointer_loop.stop();
        if let Some(window) = app.get_webview_window(self.window.label) {
            let _ = window.hide();
        }
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || self.report_pointer(&app_handle, None));
    }

    fn watch_pointer(&'static self, window: WebviewWindow) {
        let mut watch = PointerWatch::default();
        self.pointer_loop.start(POINTER_CHECK_EVERY, move || {
            let change = watch.look();
            if change.is_still() {
                return true;
            }
            let app = window.app_handle().clone();
            macos::with_ns_window(&window, move |ns_window| {
                if change.clicked && lock(&self.spot).is_none() {
                    follow_pointer(ns_window, self.anchor());
                }
                if change.released && self.window.snaps_to_corners {
                    self.snap(ns_window);
                }
                (self.window.on_pointer)(ns_window);
                let on_page = if ns_window.isVisible() {
                    let pointer = ns_window.mouseLocationOutsideOfEventStream();
                    page_point(pointer, ns_window.frame().size)
                } else {
                    None
                };
                if on_page.is_some() && !ns_window.ignoresMouseEvents() {
                    NSCursor::arrowCursor().set();
                }
                self.report_pointer(&app, on_page);
            })
            .is_ok()
        });
    }

    /// The corner the window was last snapped to, or its usual anchor.
    fn anchor(&self) -> Anchor {
        lock(&self.corner).unwrap_or(self.window.anchor)
    }

    /// Puts the window back in its corner after it changes size.
    pub(crate) fn settle(&self, ns_window: &NSWindow) {
        if let Some(screen) = ns_window.screen() {
            place(ns_window, &screen, self.anchor());
        }
    }

    /// A move with the mouse held down is a drag; anything else is the app placing the window.
    fn note_move(&self, ns_window: &NSWindow) {
        if self.window.keeps_its_spot {
            self.note_spot(ns_window);
        }
        if !self.window.snaps_to_corners || NSEvent::pressedMouseButtons() & 1 == 0 {
            return;
        }
        let now = (Instant::now(), ns_window.frame().origin);
        let mut drag = lock(&self.drag);
        let before = drag.map_or(now, |drag| drag.last);
        *drag = Some(Drag { before, last: now });
    }

    /// Glides a dropped window into the corner it was dropped or thrown toward.
    fn snap(&self, ns_window: &NSWindow) {
        let (Some(drag), Some(screen)) = (lock(&self.drag).take(), ns_window.screen()) else {
            return;
        };
        let frame = ns_window.frame();
        let visible = screen.visibleFrame();
        let corner = nearest_corner(visible, frame, drag.velocity(Instant::now()));
        *lock(&self.corner) = Some(corner);
        let origin = anchored_origin(corner, visible, frame.size);
        NSAnimationContext::beginGrouping();
        let context = NSAnimationContext::currentContext();
        context.setDuration(GLIDE_SECONDS);
        let [x1, y1, x2, y2] = GLIDE_EASE;
        context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
            x1, y1, x2, y2,
        )));
        ns_window
            .animator()
            .setFrame_display(NSRect::new(origin, frame.size), true);
        NSAnimationContext::endGrouping();
    }

    /// Remembers where the window was dragged; back at its usual spot, it follows the pointer again.
    fn note_spot(&self, ns_window: &NSWindow) {
        let Some(screen) = ns_window.screen() else {
            return;
        };
        let spot = Spot {
            screen: screen.frame(),
            bottom_center: bottom_center(ns_window.frame()),
        };
        let usual = anchored_origin(
            self.window.anchor,
            screen.visibleFrame(),
            ns_window.frame().size,
        );
        let is_usual = (usual.x - ns_window.frame().origin.x).abs() <= 1.0
            && (usual.y - ns_window.frame().origin.y).abs() <= 1.0;
        *lock(&self.spot) = (!is_usual).then_some(spot);
    }

    /// Puts the window back where it was dragged, if that screen is still there.
    fn return_to_spot(&self, ns_window: &NSWindow) -> bool {
        let Some(spot) = *lock(&self.spot) else {
            return false;
        };
        let screens = NSScreen::screens(ns_window.mtm());
        if !screens.iter().any(|screen| screen.frame() == spot.screen) {
            return false;
        }
        let width = ns_window.frame().size.width;
        ns_window.setFrameOrigin(NSPoint::new(
            spot.bottom_center.x - width / 2.0,
            spot.bottom_center.y,
        ));
        true
    }

    fn report_pointer(&self, app: &AppHandle, at: Option<Point>) {
        let Some(hover) = &self.window.hover else {
            return;
        };
        let news = self.note_pointer(at);
        if news == PointerNews::Same {
            return;
        }
        let _ = (hover.event)(at).send_to(app, self.window.label);
        match news {
            PointerNews::Entered => (hover.on_enter_or_leave)(app, true),
            PointerNews::Left => (hover.on_enter_or_leave)(app, false),
            PointerNews::Same | PointerNews::Moved => {}
        }
    }

    fn note_pointer(&self, at: Option<Point>) -> PointerNews {
        let was = std::mem::replace(&mut *lock(&self.reported), at);
        match (was, at) {
            _ if was == at => PointerNews::Same,
            (None, Some(_)) => PointerNews::Entered,
            (Some(_), None) => PointerNews::Left,
            _ => PointerNews::Moved,
        }
    }
}

fn screen_under_pointer(main_thread: MainThreadMarker) -> Option<Retained<NSScreen>> {
    let pointer = NSEvent::mouseLocation();
    NSScreen::screens(main_thread)
        .into_iter()
        .find(|screen| Frame::from(screen.frame()).contains(Point::from(pointer)))
}

fn place(ns_window: &NSWindow, screen: &NSScreen, anchor: Anchor) {
    ns_window.setFrameOrigin(anchored_origin(
        anchor,
        screen.visibleFrame(),
        ns_window.frame().size,
    ));
}

fn follow_pointer(ns_window: &NSWindow, anchor: Anchor) {
    let Some(screen) = screen_under_pointer(ns_window.mtm()) else {
        return;
    };
    let current = ns_window.screen().map(|current| current.frame());
    if current != Some(screen.frame()) {
        place(ns_window, &screen, anchor);
    }
}

fn bottom_center(frame: NSRect) -> NSPoint {
    NSPoint::new(frame.origin.x + frame.size.width / 2.0, frame.origin.y)
}

fn anchored_origin(anchor: Anchor, visible: NSRect, window: NSSize) -> NSPoint {
    let left = visible.origin.x + EDGE_GAP;
    let right = visible.origin.x + visible.size.width - window.width - EDGE_GAP;
    let bottom = visible.origin.y + EDGE_GAP;
    let top = visible.origin.y + visible.size.height - window.height - EDGE_GAP;
    match anchor {
        Anchor::BottomCenter => NSPoint::new(
            (visible.origin.x + (visible.size.width - window.width) / 2.0).round(),
            bottom,
        ),
        Anchor::BottomLeft => NSPoint::new(left, bottom),
        Anchor::BottomRight => NSPoint::new(right, bottom),
        Anchor::TopLeft => NSPoint::new(left, top),
        Anchor::TopRight => NSPoint::new(right, top),
    }
}

/// The corner whose quarter of the screen the window's center lands in, after it travels
/// on at the speed it was thrown.
fn nearest_corner(visible: NSRect, window: NSRect, velocity: NSPoint) -> Anchor {
    let x = window.origin.x + window.size.width / 2.0 + velocity.x * THROW_SECONDS;
    let y = window.origin.y + window.size.height / 2.0 + velocity.y * THROW_SECONDS;
    let is_left = x < visible.origin.x + visible.size.width / 2.0;
    let is_bottom = y < visible.origin.y + visible.size.height / 2.0;
    match (is_left, is_bottom) {
        (true, true) => Anchor::BottomLeft,
        (false, true) => Anchor::BottomRight,
        (true, false) => Anchor::TopLeft,
        (false, false) => Anchor::TopRight,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PointerChange {
    moved: bool,
    clicked: bool,
    released: bool,
}

impl PointerChange {
    fn is_still(self) -> bool {
        !self.moved && !self.clicked && !self.released
    }
}

#[derive(Default)]
struct PointerWatch {
    last: Option<(Point, bool)>,
}

impl PointerWatch {
    fn look(&mut self) -> PointerChange {
        let at = Point::from(NSEvent::mouseLocation());
        let is_down = NSEvent::pressedMouseButtons() & 1 != 0;
        self.update(at, is_down)
    }

    fn update(&mut self, at: Point, is_down: bool) -> PointerChange {
        let was_down = self.last.is_some_and(|(_, was_down)| was_down);
        let change = PointerChange {
            moved: self.last.is_none_or(|(last_at, _)| last_at != at),
            clicked: is_down && !was_down,
            released: !is_down && was_down,
        };
        self.last = Some((at, is_down));
        change
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchored_origin_should_sit_right_above_the_dock() {
        let laptop_visible = NSRect::new(NSPoint::new(0.0, 80.0), NSSize::new(1512.0, 869.0));
        let bar = NSSize::new(1000.0, 58.0);
        let center = anchored_origin(Anchor::BottomCenter, laptop_visible, bar);
        assert_eq!((center.x, center.y), (256.0, 80.0 + EDGE_GAP));
        let preview = NSSize::new(240.0, 176.0);
        let left = anchored_origin(Anchor::BottomLeft, laptop_visible, preview);
        assert_eq!((left.x, left.y), (EDGE_GAP, 80.0 + EDGE_GAP));
    }

    #[test]
    fn a_dropped_window_should_snap_to_its_quarter_and_a_throw_should_carry_it_on() {
        let visible = NSRect::new(NSPoint::new(0.0, 80.0), NSSize::new(1512.0, 869.0));
        let at = |x, y| NSRect::new(NSPoint::new(x, y), NSSize::new(360.0, 225.0));
        let still = NSPoint::new(0.0, 0.0);
        assert_eq!(
            nearest_corner(visible, at(100.0, 100.0), still),
            Anchor::BottomLeft
        );
        assert_eq!(
            nearest_corner(visible, at(1000.0, 100.0), still),
            Anchor::BottomRight
        );
        assert_eq!(
            nearest_corner(visible, at(100.0, 600.0), still),
            Anchor::TopLeft
        );
        let thrown = NSPoint::new(3000.0, 2000.0);
        assert_eq!(
            nearest_corner(visible, at(300.0, 200.0), thrown),
            Anchor::TopRight
        );
        let top_right = anchored_origin(Anchor::TopRight, visible, at(0.0, 0.0).size);
        assert_eq!(
            (top_right.x, top_right.y),
            (1512.0 - 360.0 - EDGE_GAP, 80.0 + 869.0 - 225.0 - EDGE_GAP)
        );
    }

    #[test]
    fn a_throw_should_count_only_while_its_samples_are_fresh() {
        let start = Instant::now();
        let later = |ms| start + Duration::from_millis(ms);
        let drag = Drag {
            before: (start, NSPoint::new(0.0, 0.0)),
            last: (later(10), NSPoint::new(20.0, -10.0)),
        };
        let velocity = drag.velocity(later(20));
        assert_eq!((velocity.x.round(), velocity.y.round()), (2000.0, -1000.0));
        let late = drag.velocity(later(500));
        assert_eq!((late.x, late.y), (0.0, 0.0));
    }

    #[test]
    fn pointer_watch_should_report_moves_and_each_click_once() {
        let mut watch = PointerWatch::default();
        let looks = [
            (1.0, false, true, false, false),
            (1.0, false, false, false, false),
            (1.0, true, false, true, false),
            (1.0, true, false, false, false),
            (2.0, true, true, false, false),
            (2.0, false, false, false, true),
        ];
        for (x, is_down, moved, clicked, released) in looks {
            let change = watch.update(Point { x, y: 0.0 }, is_down);
            let expected = PointerChange {
                moved,
                clicked,
                released,
            };
            assert_eq!(change, expected, "at {x}, down {is_down}");
        }
        assert!(watch.update(Point { x: 2.0, y: 0.0 }, false).is_still());
    }

    static HOVERING: Floating = Floating::new(Behavior {
        label: "test",
        anchor: Anchor::BottomLeft,
        keeps_its_spot: false,
        snaps_to_corners: false,
        on_pointer: |_| {},
        hover: Some(Hover {
            event: PageEvent::PreviewPointer,
            on_enter_or_leave: |_, _| {},
        }),
    });

    #[test]
    fn hover_should_tell_the_page_only_what_changed_and_end_with_the_pointer_gone() {
        let a = Some(Point { x: 1.0, y: 2.0 });
        let b = Some(Point { x: 3.0, y: 2.0 });
        let reports = [
            (None, PointerNews::Same),
            (a, PointerNews::Entered),
            (a, PointerNews::Same),
            (b, PointerNews::Moved),
            (None, PointerNews::Left),
            (None, PointerNews::Same),
        ];
        for (at, news) in reports {
            assert_eq!(HOVERING.note_pointer(at), news, "at {at:?}");
        }
    }
}
