//! The picker session: what's being picked and what's on screen to pick from. It's sent whole
//! to the overlays whenever it changes. Also the display lookups the session needs.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::sources::{DisplayInfo, Sources};
use crate::capture::Target;
use crate::geometry::{Frame, Point};
use crate::windows::follow::SafeTop;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) enum Mode {
    Display,
    Window,
    Area,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct Session {
    pub(super) mode: Mode,
    pub(super) sources: Sources,
    /// A window chosen with Tab. It wins over the cursor until the cursor moves.
    pub(super) pinned_window_id: Option<u32>,
    pub(super) area_display_id: Option<u32>,
}

impl Session {
    /// The Area box starts on the display you're pointing at.
    pub(super) fn new(mode: Mode, sources: Sources, cursor: Option<Point>) -> Self {
        let area_display_id = display_under(&sources.displays, cursor)
            .or_else(|| sources.displays.first().map(|display| display.id));
        Self {
            mode,
            sources,
            pinned_window_id: None,
            area_display_id,
        }
    }
}

/// Everything an overlay needs to draw its first frame.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct Setup {
    pub(super) session: Session,
    pub(super) cursor: Option<Point>,
}

/// Which overlay frames a recording, and for a window, where the window sits on that display.
#[derive(Debug, PartialEq)]
pub(super) struct Framing {
    pub(super) display_id: u32,
    pub(super) window: Option<Frame>,
}

pub(super) fn framing(session: &Session, target: &Target) -> Option<Framing> {
    match *target {
        Target::Area { display_id, .. } => Some(Framing {
            display_id,
            window: None,
        }),
        Target::Window { window_id } => {
            let window = session
                .sources
                .windows
                .iter()
                .find(|window| window.id == window_id)?;
            let frame = window.frame;
            let center = Point {
                x: frame.x + frame.width / 2.0,
                y: frame.y + frame.height / 2.0,
            };
            let display = session
                .sources
                .displays
                .iter()
                .find(|display| display.frame.contains(center))?;
            Some(Framing {
                display_id: display.id,
                window: Some(Frame {
                    x: frame.x - display.frame.x,
                    y: frame.y - display.frame.y,
                    ..frame
                }),
            })
        }
        Target::Display { .. } => None,
    }
}

pub(super) fn display_under(displays: &[DisplayInfo], point: Option<Point>) -> Option<u32> {
    let point = point?;
    displays
        .iter()
        .find(|display| display.frame.contains(point))
        .map(|display| display.id)
}

/// Gives each display the safe top of the screen at its corner.
pub(super) fn apply_safe_tops(displays: &mut [DisplayInfo], tops: &[SafeTop]) {
    for display in displays {
        display.safe_top = tops
            .iter()
            .find(|top| {
                (top.x - display.frame.x).abs() < 1.0 && (top.y - display.frame.y).abs() < 1.0
            })
            .map_or(0.0, |top| top.inset);
    }
}

#[cfg(test)]
mod tests {
    use cidre::cg;

    use super::*;
    use crate::capture::CaptureSize;
    use crate::picker::sources::WindowInfo;

    fn display(id: u32, x: f64) -> DisplayInfo {
        let frame = Frame {
            x,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        };
        DisplayInfo {
            id,
            name: format!("Display {id}"),
            frame,
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
            safe_top: 0.0,
        }
    }

    #[test]
    fn display_under_should_find_the_display_with_the_cursor() {
        let displays = [display(1, 0.0), display(2, 1000.0)];
        assert_eq!(
            display_under(&displays, Some(Point { x: 1500.0, y: 10.0 })),
            Some(2)
        );
        assert_eq!(display_under(&displays, None), None);
    }

    #[test]
    fn apply_safe_tops_should_match_screens_by_corner() {
        let mut displays = [display(1, 0.0), display(2, 1000.0)];
        let notched = SafeTop {
            x: 0.0,
            y: 0.0,
            inset: 38.0,
        };
        apply_safe_tops(&mut displays, &[notched]);
        assert_eq!(displays[0].safe_top, 38.0);
        assert_eq!(displays[1].safe_top, 0.0);
    }

    #[test]
    fn framing_should_place_a_window_on_its_display() {
        let window = WindowInfo {
            id: 7,
            pid: 1,
            app: "Notes".into(),
            frame: Frame {
                x: 1100.0,
                y: 50.0,
                width: 400.0,
                height: 300.0,
            },
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
        };
        let sources = Sources {
            displays: vec![display(1, 0.0), display(2, 1000.0)],
            windows: vec![window],
            icons: Default::default(),
        };
        let session = Session::new(Mode::Window, sources, None);
        let framing = framing(&session, &Target::Window { window_id: 7 });
        let expected = Frame {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        };
        assert_eq!(
            framing,
            Some(Framing {
                display_id: 2,
                window: Some(expected),
            })
        );
    }

    #[test]
    fn session_should_start_the_area_box_under_the_cursor() {
        let sources = Sources {
            displays: vec![display(1, 0.0), display(2, 1000.0)],
            windows: Vec::new(),
            icons: Default::default(),
        };
        let session = Session::new(Mode::Area, sources, Some(Point { x: 1200.0, y: 5.0 }));
        assert_eq!(session.area_display_id, Some(2));
    }
}
