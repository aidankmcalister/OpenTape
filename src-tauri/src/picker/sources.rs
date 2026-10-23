//! Frames are in global points with a top-left origin, the same space as the cursor.

use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
};

use anyhow::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use cidre::{cg, sc};
use objc2::AllocAnyThread;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::capture::{self, CaptureSize, NORMAL_WINDOW_LAYER, Target};
use crate::geometry::{Frame, Point};
use crate::macos;
use crate::util::lock;
use crate::windows::SafeTop;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(super) struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub frame: Frame,
    pub size: CaptureSize,
    pub scale: f64,
    pub safe_top: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(super) struct WindowInfo {
    pub id: u32,
    pub pid: u32,
    pub app: String,
    pub frame: Frame,
    pub size: CaptureSize,
    pub display_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(super) struct Sources {
    pub displays: Vec<DisplayInfo>,
    pub windows: Vec<WindowInfo>,
    pub icons: HashMap<u32, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum Mode {
    Display,
    Window,
    Area,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Session {
    pub(super) mode: Mode,
    pub(super) sources: Sources,
    pub(super) pinned_window_id: Option<u32>,
    pub(super) area_display_id: Option<u32>,
}

impl Session {
    pub(super) fn new(mode: Mode, sources: Sources, cursor: Option<Point>) -> Self {
        let area_display_id = cursor
            .and_then(|cursor| display_under(&sources.displays, cursor))
            .or_else(|| sources.displays.first().map(|display| display.id));
        Self {
            mode,
            sources,
            pinned_window_id: None,
            area_display_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Setup {
    pub(super) session: Session,
    pub(super) cursor: Option<Point>,
}

#[derive(Debug, PartialEq)]
pub(super) struct Framing {
    pub(super) display_id: u32,
    pub(super) window: Option<Frame>,
}

static ICONS: LazyLock<Mutex<HashMap<u32, String>>> = LazyLock::new(Mutex::default);

pub(super) fn list() -> Result<Sources> {
    let content = capture::shareable_content()?;
    let mut displays = Vec::new();
    for (index, display) in content.displays().iter().enumerate() {
        let scale = capture::display_scale(display);
        displays.push(DisplayInfo {
            id: display.display_id().0,
            name: format!("Display {}", index + 1),
            frame: Frame::from(display.frame()),
            size: CaptureSize::of(display.frame(), scale),
            scale,
            safe_top: 0.0,
        });
    }
    let mut windows = Vec::new();
    for window in content.windows().iter() {
        if let Some(info) = pickable_window(&content, window, &displays) {
            windows.push(info);
        }
    }
    sort_front_to_back(&mut windows, &stacking_order());
    let pids: HashSet<u32> = windows.iter().map(|window| window.pid).collect();
    let known = lock(&ICONS).clone();
    let mut icons = HashMap::new();
    for pid in pids {
        let icon = known.get(&pid).cloned().or_else(|| icon_data_url(pid));
        if let Some(icon) = icon {
            icons.insert(pid, icon);
        }
    }
    lock(&ICONS).clone_from(&icons);
    Ok(Sources {
        displays,
        windows,
        icons,
    })
}

/// Window ids front to back, since ScreenCaptureKit's list has no set order.
pub(super) fn stacking_order() -> Vec<u32> {
    let options = cg::WindowListOpt::ON_SCREEN_ONLY | cg::WindowListOpt::EXCLUDE_DESKTOP_ELEMENTS;
    cg::WindowList::new(options, cg::WINDOW_ID_NULL)
        .map(|list| (0..list.len()).map(|index| list.get(index)).collect())
        .unwrap_or_default()
}

pub(super) fn framing(session: &Session, target: &Target) -> Option<Framing> {
    match *target {
        Target::Area { display_id, .. } => Some(Framing {
            display_id,
            window: None,
        }),
        Target::Window { window_id } => window_framing(&session.sources, window_id),
        Target::Display { .. } => None,
    }
}

fn window_framing(sources: &Sources, window_id: u32) -> Option<Framing> {
    let window = sources
        .windows
        .iter()
        .find(|window| window.id == window_id)?;
    let display = sources
        .displays
        .iter()
        .find(|display| Some(display.id) == window.display_id)?;
    let frame = window.frame;
    Some(Framing {
        display_id: display.id,
        window: Some(Frame {
            x: frame.x - display.frame.x,
            y: frame.y - display.frame.y,
            ..frame
        }),
    })
}

fn display_under(displays: &[DisplayInfo], point: Point) -> Option<u32> {
    displays
        .iter()
        .find(|display| display.frame.contains(point))
        .map(|display| display.id)
}

fn display_at_center(displays: &[DisplayInfo], frame: Frame) -> Option<u32> {
    let center = Point {
        x: frame.x + frame.width / 2.0,
        y: frame.y + frame.height / 2.0,
    };
    display_under(displays, center)
}

pub(super) fn apply_safe_tops(displays: &mut [DisplayInfo], tops: &[SafeTop]) {
    for display in displays {
        let frame = display.frame;
        display.safe_top = tops
            .iter()
            .find(|top| (top.x - frame.x).abs() < 1.0 && (top.y - frame.y).abs() < 1.0)
            .map_or(0.0, |top| top.inset);
    }
}

fn pickable_window(
    content: &sc::ShareableContent,
    window: &sc::Window,
    displays: &[DisplayInfo],
) -> Option<WindowInfo> {
    let app = window.owning_app()?;
    let owner_pid = u32::try_from(app.process_id()).ok()?;
    let frame = Frame::from(window.frame());
    let is_own_window = owner_pid == std::process::id();
    if is_own_window || !is_pickable(window.window_layer(), window.is_on_screen(), frame) {
        return None;
    }
    // The capture picks its display by the window's corner, not its center.
    let capture_display = capture::display_of(content, window).ok()?.display_id().0;
    let scale = displays
        .iter()
        .find(|display| display.id == capture_display)?
        .scale;
    Some(WindowInfo {
        id: window.id(),
        pid: owner_pid,
        app: app.app_name().to_string(),
        frame,
        size: CaptureSize::of(window.frame(), scale),
        display_id: display_at_center(displays, frame),
    })
}

fn is_pickable(layer: isize, on_screen: bool, frame: Frame) -> bool {
    layer == NORMAL_WINDOW_LAYER && on_screen && frame.width >= 40.0 && frame.height >= 40.0
}

fn sort_front_to_back(windows: &mut [WindowInfo], order: &[u32]) {
    windows.sort_by_key(|window| {
        order
            .iter()
            .position(|&id| id == window.id)
            .unwrap_or(usize::MAX)
    });
}

fn icon_data_url(pid: u32) -> Option<String> {
    // Fine off the main thread: Apple documents these icon calls as thread safe.
    let png = macos::catch(|| -> Option<Vec<u8>> {
        let pid = pid.try_into().ok()?;
        let icon = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?.icon()?;
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(64.0, 64.0));
        let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
        // SAFETY: an empty properties dictionary has no untyped values.
        let data = unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }?;
        Some(data.to_vec())
    });
    let png = png.unwrap_or_else(|err| {
        eprintln!("could not draw the icon of app {pid}: {err:#}");
        None
    });
    png.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: u32, x: f64) -> DisplayInfo {
        DisplayInfo {
            id,
            name: format!("Display {id}"),
            frame: Frame {
                x,
                y: 0.0,
                width: 1000.0,
                height: 800.0,
            },
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
            scale: 2.0,
            safe_top: 0.0,
        }
    }

    fn window(id: u32, x: f64) -> WindowInfo {
        WindowInfo {
            id,
            pid: 1,
            app: "Notes".into(),
            frame: Frame {
                x,
                y: 50.0,
                width: 400.0,
                height: 300.0,
            },
            size: CaptureSize::of(cg::Rect::zero(), 2.0),
            display_id: None,
        }
    }

    fn two_displays_with(mut windows: Vec<WindowInfo>) -> Sources {
        let displays = vec![display(1, 0.0), display(2, 1000.0)];
        for window in &mut windows {
            window.display_id = display_at_center(&displays, window.frame);
        }
        Sources {
            displays,
            windows,
            icons: HashMap::new(),
        }
    }

    #[test]
    fn framing_should_find_the_overlay_and_the_spot_a_recording_shows_in() {
        let windows = [1100.0, 700.0, 850.0, 5000.0];
        let windows = windows.iter().zip(1..).map(|(&x, id)| window(id, x));
        let session = Session::new(Mode::Window, two_displays_with(windows.collect()), None);
        let framed = |display_id, x| {
            let window = Frame {
                x,
                y: 50.0,
                width: 400.0,
                height: 300.0,
            };
            Some(Framing {
                display_id,
                window: Some(window),
            })
        };
        let area = Target::Area {
            display_id: 2,
            x: 10.0,
            y: 20.0,
            width: 300.0,
            height: 200.0,
        };
        let cases = [
            (Target::Window { window_id: 1 }, framed(2, 100.0)),
            (Target::Window { window_id: 2 }, framed(1, 700.0)),
            (Target::Window { window_id: 3 }, framed(2, -150.0)),
            (Target::Window { window_id: 4 }, None),
            (Target::Window { window_id: 5 }, None),
            (
                area,
                Some(Framing {
                    display_id: 2,
                    window: None,
                }),
            ),
            (Target::Display { display_id: 1 }, None),
        ];
        for (target, expected) in cases {
            assert_eq!(framing(&session, &target), expected, "{target:?}");
        }
    }

    #[test]
    fn area_box_should_start_under_the_cursor_or_else_on_the_first_display() {
        let cursor = Some(Point { x: 1200.0, y: 5.0 });
        let under = Session::new(Mode::Area, two_displays_with(Vec::new()), cursor);
        assert_eq!(under.area_display_id, Some(2));
        let no_cursor = Session::new(Mode::Area, two_displays_with(Vec::new()), None);
        assert_eq!(no_cursor.area_display_id, Some(1));
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
    fn sort_front_to_back_should_follow_the_stacking_order_and_put_unknown_windows_last() {
        let mut windows = vec![
            window(9, 0.0),
            window(1, 0.0),
            window(2, 0.0),
            window(3, 0.0),
        ];
        sort_front_to_back(&mut windows, &[3, 1, 2]);
        let ids: Vec<u32> = windows.iter().map(|window| window.id).collect();
        assert_eq!(ids, [3, 1, 2, 9]);
    }

    #[test]
    fn is_pickable_should_skip_menus_hidden_and_tiny_windows() {
        let big = window(1, 0.0).frame;
        let tiny = Frame { width: 10.0, ..big };
        assert!(is_pickable(0, true, big));
        assert!(!is_pickable(25, true, big));
        assert!(!is_pickable(0, false, big));
        assert!(!is_pickable(0, true, tiny));
    }
}
