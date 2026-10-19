//! What can be picked: the displays and the on-screen windows, with their frames in global
//! points (top-left origin), the same space as the cursor position. Also the picker session
//! built from them, which is sent whole to the overlays whenever it changes.

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
    /// "Display 1", "Display 2", in ScreenCaptureKit's order.
    pub name: String,
    pub frame: Frame,
    pub size: CaptureSize,
    /// Pixels per point. The Area box uses it to show its size in pixels while you drag it.
    pub scale: f64,
    /// How far down from the top things stay clear of the menu bar and the notch, in points.
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
    /// The display holding the window's center: where its capture bar shows when it's pinned,
    /// and whose overlay frames its recording. `None` when the center is off every display.
    pub display_id: Option<u32>,
}

/// Displays, and windows ordered front to back so the first hit under the cursor is the visible one.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(super) struct Sources {
    pub displays: Vec<DisplayInfo>,
    pub windows: Vec<WindowInfo>,
    /// One icon per app, by process ID, so apps with many windows send it once.
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
    /// A window chosen with Tab. It wins over the cursor until the cursor moves.
    pub(super) pinned_window_id: Option<u32>,
    pub(super) area_display_id: Option<u32>,
}

impl Session {
    /// The Area box starts on the display you're pointing at.
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

/// Everything an overlay needs to draw its first frame.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
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

/// App icons already drawn, by process ID. Drawing every icon again made each open of the picker
/// slow, so only apps new since the last list draw theirs, and apps that quit drop out.
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

/// Window ids from front to back, since ScreenCaptureKit's list has no set order. Cheap enough to
/// poll for changes. Empty when macOS gives no list, and then the windows keep ScreenCaptureKit's
/// order.
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

/// The window's own display, and where the window sits on it.
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

/// A window straddling two displays goes by its center, which is on the one showing more of it.
fn display_at_center(displays: &[DisplayInfo], frame: Frame) -> Option<u32> {
    let center = Point {
        x: frame.x + frame.width / 2.0,
        y: frame.y + frame.height / 2.0,
    };
    display_under(displays, center)
}

/// Gives each display the safe top of the screen whose corner is within a point of its own.
pub(super) fn apply_safe_tops(displays: &mut [DisplayInfo], tops: &[SafeTop]) {
    for display in displays {
        let frame = display.frame;
        display.safe_top = tops
            .iter()
            .find(|top| (top.x - frame.x).abs() < 1.0 && (top.y - frame.y).abs() < 1.0)
            .map_or(0.0, |top| top.inset);
    }
}

/// `None` for a window not worth offering, and for this app's own windows.
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
    // Sized at the scale of the display the capture will use, which goes by the window's corner.
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

/// Normal app windows that are on screen and big enough to mean something: smaller ones are
/// usually invisible helpers, not something you'd record.
fn is_pickable(layer: isize, on_screen: bool, frame: Frame) -> bool {
    layer == NORMAL_WINDOW_LAYER && on_screen && frame.width >= 40.0 && frame.height >= 40.0
}

/// Sorts by position in `order`. Windows missing from it go last.
fn sort_front_to_back(windows: &mut [WindowInfo], order: &[u32]) {
    windows.sort_by_key(|window| {
        order
            .iter()
            .position(|&id| id == window.id)
            .unwrap_or(usize::MAX)
    });
}

/// The app's icon as a small PNG data URL, so the picker can show the app it's about to record.
/// `None` when the app has no icon, or macOS fails to draw it; the picker then shows none.
fn icon_data_url(pid: u32) -> Option<String> {
    // Runs off the main thread while the picker lists what's on screen. That's allowed: Apple
    // documents `NSRunningApplication` as thread safe, and an `NSImage` as safe to draw from a
    // secondary thread while no other thread changes it. Nothing changes these icons, each bitmap
    // stays on one thread, and none of these calls asks for a `MainThreadMarker`.
    let png = macos::catch(|| -> Option<Vec<u8>> {
        let pid = pid.try_into().ok()?;
        let icon = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?.icon()?;
        // 32 points on a 2x display.
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(64.0, 64.0));
        // SAFETY: `rect` is a live, writable NSRect for the whole call, which is all the method
        // asks of it. No context and no hints are both allowed.
        let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
        // SAFETY: the method is unsafe because the dictionary's values are untyped. An empty
        // dictionary has none, and it's valid for every file type.
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

    /// A 1000 x 800 display at (`x`, 0).
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

    /// A 400 x 300 window at (`x`, 50), on no display until `two_displays_with` places it.
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

    /// Two displays side by side, 1 from x 0 and 2 from x 1000, holding `windows`, each placed
    /// on a display the way `list` places them.
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
        // Where a 400 x 300 window at (`x`, 50) shows on display `display_id`.
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
            // A window straddling two displays goes by its center.
            (Target::Window { window_id: 2 }, framed(1, 700.0)),
            (Target::Window { window_id: 3 }, framed(2, -150.0)),
            // A window off every display, or gone, isn't framed.
            (Target::Window { window_id: 4 }, None),
            (Target::Window { window_id: 5 }, None),
            // An area is framed on its display, without a window.
            (
                area,
                Some(Framing {
                    display_id: 2,
                    window: None,
                }),
            ),
            // A whole display needs no frame.
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
