use anyhow::{Context, Result, anyhow};
use cidre::{arc, cf, cg, cm, ns, sc, sys};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::CAPTURE_LIMIT;
use crate::geometry::{to_display_relative, to_global};
use crate::util::wait;

pub(crate) const NORMAL_WINDOW_LAYER: isize = 0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings.ts")]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Target {
    Display {
        display_id: u32,
    },
    Window {
        window_id: u32,
    },
    Area {
        display_id: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

pub(super) struct CapturePlan {
    pub filter: arc::R<sc::ContentFilter>,
    pub config: arc::R<sc::StreamCfg>,
    pub size: CaptureSize,
    pub screen_rect: cg::Rect,
    /// A recorded window, which the crop follows when it moves.
    pub follows: Option<Follow>,
}

pub(super) struct Follow {
    pub window_id: u32,
    pub display: cg::Rect,
}

/// Where a window is now, in screen points; `None` once it's closed.
pub(super) fn window_frame(window_id: u32) -> Option<cg::Rect> {
    let list = cg::WindowList::info(cg::WindowListOpt::INCLUDING_WINDOW, window_id)?;
    let info = list.iter().next()?;
    let bounds = info.get(cg::window_keys::bounds())?;
    if bounds.get_type_id() != cf::Dictionary::type_id() {
        return None;
    }
    // SAFETY: checked just above that `bounds` is a CFDictionary.
    let bounds: &cf::Dictionary = unsafe { std::mem::transmute(bounds) };
    cg::Rect::from_dictionary_representation(bounds)
}

/// Moves a crop of `size` to `origin`, kept inside the display so it never records past its edge.
pub(super) fn kept_inside(origin: cg::Point, size: cg::Size, display: cg::Rect) -> cg::Point {
    let clamp =
        |at: f64, length: f64, start: f64, room: f64| at.min(start + room - length).max(start);
    cg::Point {
        x: clamp(origin.x, size.width, display.origin.x, display.size.width),
        y: clamp(origin.y, size.height, display.origin.y, display.size.height),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct CaptureSize {
    pub(super) width: usize,
    pub(super) height: usize,
}

impl CaptureSize {
    pub(crate) fn of(rect: cg::Rect, scale: f64) -> Self {
        Self {
            width: (rect.size.width * scale) as usize / 2 * 2,
            height: (rect.size.height * scale) as usize / 2 * 2,
        }
    }
}

pub(crate) fn shareable_content() -> Result<arc::R<sc::ShareableContent>> {
    wait(
        "reading the screen",
        CAPTURE_LIMIT,
        sc::ShareableContent::current(),
    )?
    .map_err(|err| anyhow!("could not read the screen (is Screen Recording allowed?): {err:?}"))
}

pub(crate) fn display_of(
    content: &sc::ShareableContent,
    window: &sc::Window,
) -> Result<arc::R<sc::Display>> {
    let origin = window.frame().origin;
    content
        .displays()
        .iter()
        .find(|display| display.frame().contains_point(&origin))
        .map(|display| display.retained())
        .context("the window is not on any display")
}

pub(crate) fn display_scale(display: &sc::Display) -> f64 {
    let filter = sc::ContentFilter::with_display_excluding_windows(display, &ns::Array::new());
    f64::from(sc::ShareableContent::info_for_filter(&filter).point_pixel_scale())
}

pub(super) fn plan_capture(target: &Target) -> Result<CapturePlan> {
    let content = shareable_content()?;
    match *target {
        Target::Display { display_id } => {
            let display = find_display(&content, display_id)?;
            let filter = without_this_app(&content, &display);
            Ok(plan(filter, &display, display.frame(), None))
        }
        Target::Window { window_id } => {
            let window = content
                .windows()
                .iter()
                .find(|window| window.id() == window_id)
                .map(|window| window.retained())
                .with_context(|| format!("window {window_id} is gone"))?;
            let display = display_of(&content, &window)?;
            let app = window.owning_app().context("window has no app")?;
            let hidden = hidden_windows(&content, Some(app.process_id()));
            let filter = sc::ContentFilter::with_display_excluding_windows(&display, &hidden);
            let src_rect = to_display_relative(window.frame(), display.frame());
            Ok(CapturePlan {
                follows: Some(Follow {
                    window_id,
                    display: display.frame(),
                }),
                ..plan(filter, &display, window.frame(), Some(src_rect))
            })
        }
        Target::Area {
            display_id,
            x,
            y,
            width,
            height,
        } => {
            let display = find_display(&content, display_id)?;
            let area = cg::Rect::new(x, y, width, height);
            let filter = without_this_app(&content, &display);
            Ok(plan(
                filter,
                &display,
                to_global(area, display.frame()),
                Some(area),
            ))
        }
    }
}

fn find_display(content: &sc::ShareableContent, display_id: u32) -> Result<arc::R<sc::Display>> {
    content
        .displays()
        .iter()
        .find(|display| display.display_id().0 == display_id)
        .map(|display| display.retained())
        .with_context(|| format!("display {display_id} is gone"))
}

fn plan(
    filter: arc::R<sc::ContentFilter>,
    display: &sc::Display,
    screen_rect: cg::Rect,
    src_rect: Option<cg::Rect>,
) -> CapturePlan {
    let size = CaptureSize::of(screen_rect, display_scale(display));
    let mut config = sc::StreamCfg::new();
    config.set_width(size.width);
    config.set_height(size.height);
    config.set_shows_cursor(false);
    config.set_minimum_frame_interval(cm::Time::new(1, 60));
    if let Some(src_rect) = src_rect {
        config.set_src_rect(src_rect);
    }
    CapturePlan {
        filter,
        config,
        size,
        screen_rect,
        follows: None,
    }
}

fn without_this_app(
    content: &sc::ShareableContent,
    display: &sc::Display,
) -> arc::R<sc::ContentFilter> {
    let own_pid = own_pid();
    let mut own_app: Vec<arc::R<sc::RunningApp>> = Vec::new();
    for app in content.apps().iter() {
        if app.process_id() == own_pid {
            own_app.push(app.retained());
        }
    }
    if own_app.is_empty() {
        return sc::ContentFilter::with_display_excluding_windows(
            display,
            &hidden_windows(content, None),
        );
    }
    sc::ContentFilter::with_display_excluding_apps_excepting_windows(
        display,
        &ns::Array::from_slice_retained(&own_app),
        &ns::Array::new(),
    )
}

fn hidden_windows(
    content: &sc::ShareableContent,
    recorded_app: Option<sys::Pid>,
) -> arc::R<ns::Array<sc::Window>> {
    let own_pid = own_pid();
    let mut hidden: Vec<arc::R<sc::Window>> = Vec::new();
    for window in content.windows().iter() {
        let owner = window.owning_app().map(|app| app.process_id());
        if hides(window.window_layer(), owner, own_pid, recorded_app) {
            hidden.push(window.retained());
        }
    }
    ns::Array::from_slice_retained(&hidden)
}

fn hides(
    layer: isize,
    owner: Option<sys::Pid>,
    own_pid: sys::Pid,
    recorded_app: Option<sys::Pid>,
) -> bool {
    let Some(owner) = owner else {
        return false;
    };
    if owner == own_pid {
        return true;
    }
    recorded_app.is_some_and(|app| layer == NORMAL_WINDOW_LAYER && owner != app)
}

fn own_pid() -> sys::Pid {
    sys::Pid::try_from(std::process::id()).unwrap_or(-1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_should_read_what_the_frontend_sends() {
        let window: Target = serde_json::from_str(r#"{"kind":"window","windowId":398}"#).unwrap();
        assert_eq!(window, Target::Window { window_id: 398 });
        let json = r#"{"kind":"area","displayId":1,"x":100,"y":50,"width":1280,"height":720}"#;
        let area: Target = serde_json::from_str(json).unwrap();
        assert_eq!(
            area,
            Target::Area {
                display_id: 1,
                x: 100.0,
                y: 50.0,
                width: 1280.0,
                height: 720.0
            }
        );
    }

    #[test]
    fn hides_should_leave_out_this_app_and_whatever_covers_a_recorded_window() {
        const OWN: sys::Pid = 1;
        let cases = [
            (0, Some(200), true, true),
            (0, Some(100), true, false),
            (101, Some(200), true, false),
            (101, Some(OWN), true, true),
            (25, Some(OWN), false, true),
            (0, Some(200), false, false),
            (0, None, true, false),
            (0, None, false, false),
        ];
        for (layer, owner, recording_window, hidden) in cases {
            let recorded_app = recording_window.then_some(100);
            assert_eq!(
                hides(layer, owner, OWN, recorded_app),
                hidden,
                "layer {layer}, owner {owner:?}, recorded app {recorded_app:?}"
            );
        }
        assert_eq!(own_pid(), std::process::id() as sys::Pid);
    }

    #[test]
    fn kept_inside_should_follow_a_window_but_stop_at_the_display_edge() {
        let display = cg::Rect::new(0.0, 0.0, 1000.0, 800.0);
        let size = cg::Size {
            width: 400.0,
            height: 300.0,
        };
        let at = |x, y| kept_inside(cg::Point { x, y }, size, display);
        assert_eq!(at(100.0, 50.0), cg::Point { x: 100.0, y: 50.0 });
        assert_eq!(at(900.0, 700.0), cg::Point { x: 600.0, y: 500.0 });
        assert_eq!(at(-50.0, -20.0), cg::Point { x: 0.0, y: 0.0 });
        let second = cg::Rect::new(1000.0, 0.0, 1000.0, 800.0);
        let moved = kept_inside(
            cg::Point {
                x: 1200.0,
                y: 100.0,
            },
            size,
            second,
        );
        assert_eq!(
            moved,
            cg::Point {
                x: 1200.0,
                y: 100.0
            }
        );
    }

    #[test]
    fn capture_size_should_round_each_side_down_to_even_pixels() {
        let cases = [
            (920.5, 2.0, 1840),
            (333.0, 1.5, 498),
            (100.0, 1.0, 100),
            (982.5, 2.0, 1964),
        ];
        for (points, scale, pixels) in cases {
            let size = CaptureSize::of(cg::Rect::new(40.0, 60.0, points, points), scale);
            assert_eq!(
                (size.width, size.height),
                (pixels, pixels),
                "{points} at {scale}x"
            );
        }
    }
}
