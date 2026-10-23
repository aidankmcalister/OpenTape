use std::{sync::Mutex, time::Duration};

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{NSCursor, NSEvent, NSPopUpMenuWindowLevel, NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::geometry::{Frame, Point, page_point};
use crate::util::{Poller, lock};
use crate::{PageEvent, macos};

const POINTER_CHECK_EVERY: Duration = Duration::from_millis(33);
const EDGE_GAP: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Anchor {
    BottomCenter,
    BottomLeft,
}

pub(crate) struct Behaviour {
    pub label: &'static str,
    pub anchor: Anchor,
    pub keeps_its_spot: bool,
    pub on_pointer: fn(&NSWindow),
    pub hover: Option<Hover>,
}

/// Pages in a non-key window get no mouse moves, so Rust reports the pointer.
pub(crate) struct Hover {
    pub event: fn(Option<Point>) -> PageEvent,
    pub on_enter_or_leave: fn(&AppHandle, bool),
}

pub(crate) struct Floating {
    window: Behaviour,
    pointer_loop: Poller,
    reported: Mutex<Option<Point>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PointerNews {
    Same,
    Moved,
    Entered,
    Left,
}

impl Floating {
    pub(crate) const fn new(window: Behaviour) -> Self {
        Self {
            window,
            pointer_loop: Poller::new(),
            reported: Mutex::new(None),
        }
    }

    pub(crate) fn setup(&self, window: &WebviewWindow) -> tauri::Result<()> {
        super::never_close(window);
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
        let anchor = self.window.anchor;
        let _ = macos::with_ns_window(&window, move |ns_window| {
            let main_thread = ns_window.mtm();
            if main_display {
                if let Some(main) = NSScreen::screens(main_thread).firstObject() {
                    place(ns_window, &main, anchor);
                }
            } else if self.window.keeps_its_spot {
                follow_pointer(ns_window, anchor);
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
        // Queued behind any in-flight look, so the page always hears it left and gives keys back.
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
                if change.clicked {
                    follow_pointer(ns_window, self.window.anchor);
                }
                (self.window.on_pointer)(ns_window);
                let on_page = if ns_window.isVisible() {
                    let pointer = ns_window.mouseLocationOutsideOfEventStream();
                    page_point(pointer, ns_window.frame().size)
                } else {
                    None
                };
                // Never key, so macOS never resets the cursor over it.
                if on_page.is_some() && !ns_window.ignoresMouseEvents() {
                    NSCursor::arrowCursor().set();
                }
                self.report_pointer(&app, on_page);
            })
            .is_ok()
        });
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

fn anchored_origin(anchor: Anchor, visible: NSRect, window: NSSize) -> NSPoint {
    match anchor {
        Anchor::BottomCenter => NSPoint::new(
            (visible.origin.x + (visible.size.width - window.width) / 2.0).round(),
            visible.origin.y + EDGE_GAP,
        ),
        Anchor::BottomLeft => {
            NSPoint::new(visible.origin.x + EDGE_GAP, visible.origin.y + EDGE_GAP)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PointerChange {
    moved: bool,
    clicked: bool,
}

impl PointerChange {
    fn is_still(self) -> bool {
        !self.moved && !self.clicked
    }
}

#[derive(Default)]
struct PointerWatch {
    last: Option<(Point, bool)>,
}

impl PointerWatch {
    // These NSEvent class methods are fine off the main thread.
    fn look(&mut self) -> PointerChange {
        let at = Point::from(NSEvent::mouseLocation());
        let is_down = NSEvent::pressedMouseButtons() & 1 != 0;
        self.update(at, is_down)
    }

    fn update(&mut self, at: Point, is_down: bool) -> PointerChange {
        let change = PointerChange {
            moved: self.last.is_none_or(|(last_at, _)| last_at != at),
            clicked: is_down && !self.last.is_some_and(|(_, was_down)| was_down),
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
    fn pointer_watch_should_report_moves_and_each_click_once() {
        let mut watch = PointerWatch::default();
        let looks = [
            (1.0, false, true, false),
            (1.0, false, false, false),
            (1.0, true, false, true),
            (1.0, true, false, false),
            (2.0, true, true, false),
        ];
        for (x, is_down, moved, clicked) in looks {
            let change = watch.update(Point { x, y: 0.0 }, is_down);
            let expected = PointerChange { moved, clicked };
            assert_eq!(change, expected, "at {x}, down {is_down}");
        }
        assert!(watch.update(Point { x: 2.0, y: 0.0 }, true).is_still());
    }

    static HOVERING: Floating = Floating::new(Behaviour {
        label: "test",
        anchor: Anchor::BottomLeft,
        keeps_its_spot: false,
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
