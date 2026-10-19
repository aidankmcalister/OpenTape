//! The pointer as the floating windows' loops see it. It's read without the main thread, so a
//! loop can skip its main-thread check while the pointer sits still. That's allowed: these
//! `NSEvent` class methods only read global state, and objc2-app-kit lets any thread call them
//! (they ask for no `MainThreadMarker`). Neither throws, so there's nothing to catch.

use std::time::Duration;

use objc2_app_kit::NSEvent;

use crate::geometry::Point;

/// How often the bar and the preview look at the pointer.
pub(crate) const CHECK_EVERY: Duration = Duration::from_millis(33);
const LEFT_BUTTON: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pointer {
    /// In global points, bottom-left origin. Only compared, never drawn.
    at: Point,
    is_down: bool,
}

pub(crate) fn now() -> Pointer {
    Pointer {
        at: Point::from(NSEvent::mouseLocation()),
        is_down: NSEvent::pressedMouseButtons() & LEFT_BUTTON != 0,
    }
}

/// What changed since the last look.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Change {
    pub moved: bool,
    /// The left button went down.
    pub clicked: bool,
}

/// Remembers the last pointer, to tell what changed. The first look counts as a move.
#[derive(Default)]
pub(crate) struct Watch {
    last: Option<Pointer>,
}

impl Watch {
    pub(crate) fn update(&mut self, now: Pointer) -> Change {
        let change = Change {
            moved: self.last.is_none_or(|last| last.at != now.at),
            clicked: now.is_down && !self.last.is_some_and(|last| last.is_down),
        };
        self.last = Some(now);
        change
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pointer(x: f64, is_down: bool) -> Pointer {
        Pointer {
            at: Point { x, y: 0.0 },
            is_down,
        }
    }

    #[test]
    fn watch_should_count_the_first_look_as_a_move() {
        let mut watch = Watch::default();
        let change = watch.update(pointer(1.0, false));
        assert!(change.moved);
        assert!(!change.clicked);
    }

    #[test]
    fn watch_should_report_nothing_while_the_pointer_sits_still() {
        let mut watch = Watch::default();
        watch.update(pointer(1.0, false));
        let change = watch.update(pointer(1.0, false));
        assert_eq!(
            change,
            Change {
                moved: false,
                clicked: false
            }
        );
    }

    #[test]
    fn watch_should_report_a_click_once_while_the_button_is_held() {
        let mut watch = Watch::default();
        watch.update(pointer(1.0, false));
        assert!(watch.update(pointer(1.0, true)).clicked);
        assert!(!watch.update(pointer(1.0, true)).clicked);
        assert!(watch.update(pointer(2.0, true)).moved);
    }
}
