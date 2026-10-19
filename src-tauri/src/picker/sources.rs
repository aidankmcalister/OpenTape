//! What can be picked: the displays and the on-screen windows, with their frames in
//! global points (top-left origin), the same space as the cursor position.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use cidre::cg;
use serde::Serialize;
use ts_rs::TS;

use crate::capture::{self, CaptureSize};
use crate::geometry::Frame;
use crate::macos::app_icons;

/// Smaller windows are usually invisible helpers, not something you'd record.
const MIN_WINDOW_SIDE: f64 = 40.0;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(super) struct DisplayInfo {
    pub id: u32,
    /// "Display 1", "Display 2", in ScreenCaptureKit's order.
    pub name: String,
    pub frame: Frame,
    pub size: CaptureSize,
    /// How far down from the top things stay clear of the menu bar and the notch, in points.
    pub safe_top: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(super) struct WindowInfo {
    pub id: u32,
    pub pid: u32,
    pub app: String,
    pub frame: Frame,
    pub size: CaptureSize,
}

/// Displays, and windows ordered front to back so the first hit under the cursor is the visible one.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(super) struct Sources {
    pub displays: Vec<DisplayInfo>,
    pub windows: Vec<WindowInfo>,
    /// One icon per app, by process ID, so apps with many windows send it once.
    pub icons: HashMap<u32, String>,
}

/// `known_icons` are reused by process ID, so only apps new since the last list draw theirs.
pub(super) fn list(known_icons: &HashMap<u32, String>) -> Result<Sources> {
    let content = capture::shareable_content()?;
    let mut displays = Vec::new();
    let mut scales = HashMap::new();
    for (index, display) in content.displays().iter().enumerate() {
        let scale = capture::display_scale(display);
        scales.insert(display.display_id().0, scale);
        displays.push(DisplayInfo {
            id: display.display_id().0,
            name: format!("Display {}", index + 1),
            frame: Frame::from(display.frame()),
            size: CaptureSize::of(display.frame(), scale),
            safe_top: 0.0,
        });
    }
    let own_pid = std::process::id();
    let mut windows: Vec<WindowInfo> = content
        .windows()
        .iter()
        .filter_map(|window| {
            let app = window.owning_app()?;
            let frame = Frame::from(window.frame());
            let owner_pid = u32::try_from(app.process_id()).ok()?;
            let pickable = is_pickable(window.window_layer(), window.is_on_screen(), frame)
                && owner_pid != own_pid;
            let display = capture::display_of(&content, window).ok()?;
            let scale = scales.get(&display.display_id().0).copied()?;
            pickable.then(|| WindowInfo {
                id: window.id(),
                pid: owner_pid,
                app: app.app_name().to_string(),
                frame,
                size: CaptureSize::of(window.frame(), scale),
            })
        })
        .collect();
    sort_front_to_back(&mut windows, &stacking_order());
    let icons = icons_for(&windows, known_icons);
    Ok(Sources {
        displays,
        windows,
        icons,
    })
}

fn icons_for(windows: &[WindowInfo], known: &HashMap<u32, String>) -> HashMap<u32, String> {
    let pids: HashSet<u32> = windows.iter().map(|window| window.pid).collect();
    pids.into_iter()
        .filter_map(|pid| {
            let icon = known
                .get(&pid)
                .cloned()
                .or_else(|| app_icons::data_url(pid))?;
            Some((pid, icon))
        })
        .collect()
}

/// Normal app windows (layer 0) that are on screen and big enough to mean something.
fn is_pickable(layer: isize, on_screen: bool, frame: Frame) -> bool {
    layer == 0 && on_screen && frame.width >= MIN_WINDOW_SIDE && frame.height >= MIN_WINDOW_SIDE
}

/// Window ids from front to back. ScreenCaptureKit doesn't promise an order, but this does.
/// Cheap enough to poll: it changes when windows open, close, refocus or a space switches.
/// Without a list, the windows just stay in ScreenCaptureKit's order.
pub(super) fn stacking_order() -> Vec<u32> {
    let options = cg::WindowListOpt::ON_SCREEN_ONLY | cg::WindowListOpt::EXCLUDE_DESKTOP_ELEMENTS;
    cg::WindowList::new(options, cg::WINDOW_ID_NULL)
        .map(|list| (0..list.len()).map(|index| list.get(index)).collect())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;

    const BIG: Frame = Frame {
        x: 0.0,
        y: 0.0,
        width: 800.0,
        height: 600.0,
    };

    fn window(id: u32) -> WindowInfo {
        WindowInfo {
            id,
            pid: 1,
            app: "App".to_string(),
            frame: BIG,
            size: CaptureSize::of(cidre::cg::Rect::zero(), 2.0),
        }
    }

    #[test]
    fn sort_front_to_back_should_follow_the_stacking_order() {
        let mut windows = vec![window(1), window(2), window(3)];
        sort_front_to_back(&mut windows, &[3, 1, 2]);
        let ids: Vec<u32> = windows.iter().map(|w| w.id).collect();
        assert_eq!(ids, [3, 1, 2]);
    }

    #[test]
    fn sort_front_to_back_should_put_unknown_windows_last() {
        let mut windows = vec![window(9), window(1)];
        sort_front_to_back(&mut windows, &[1]);
        assert_eq!(windows[1].id, 9);
    }

    #[test]
    fn is_pickable_should_skip_menus_and_tiny_windows() {
        let tiny = Frame { width: 10.0, ..BIG };
        assert!(is_pickable(0, true, BIG));
        assert!(!is_pickable(25, true, BIG));
        assert!(!is_pickable(0, false, BIG));
        assert!(!is_pickable(0, true, tiny));
    }
}
