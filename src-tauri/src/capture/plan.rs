use std::collections::HashSet;

use anyhow::{Context, Result, anyhow};
use cidre::{arc, cf, cg, cm, ns, sc, sys};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::CAPTURE_LIMIT;
use crate::geometry::{to_display_relative, to_global};
use crate::util::wait;

pub(crate) const NORMAL_WINDOW_LAYER: isize = 0;
/// Floating panels and palettes sit above ordinary windows, up to this layer.
pub(crate) const FLOATING_WINDOW_LAYER: isize = 3;

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
    /// A recorded window, watched so the video and the dimming around it follow it.
    pub follows: Option<Follow>,
    /// For a window, what its system audio comes from: the whole display minus this app. The
    /// window's own filter leaves out every other app, and macOS drops their sound with them.
    pub sound: Option<arc::R<sc::ContentFilter>>,
}

/// A recorded window and its display, checked many times a second: during the countdown for the
/// dimming, and while recording for the video's crop (see `writer::WindowFramer`).
pub(crate) struct Follow {
    window_id: u32,
    pub(crate) display_id: u32,
    pub(crate) display: cg::Rect,
    /// Where the window is now, in screen points.
    pub(crate) window: cg::Rect,
    /// Pixels per point the display is captured at.
    pub(crate) scale: f64,
}

impl Follow {
    fn new(window: &sc::Window, display: &sc::Display, scale: f64) -> Self {
        Self {
            window_id: window.id(),
            display_id: display.display_id().0,
            display: display.frame(),
            window: window.frame(),
            scale,
        }
    }

    /// Starts watching a window before its recording starts (during the countdown).
    pub(crate) fn watch(window_id: u32) -> Result<Self> {
        let content = shareable_content()?;
        let window = find_window(&content, window_id)?;
        let display = display_of(&content, &window)?;
        Ok(Self::new(&window, &display, display_scale(&display)))
    }

    /// True when the window moved or resized since last asked.
    pub(crate) fn moved(&mut self) -> bool {
        let Some(frame) = window_frame(self.window_id) else {
            return false;
        };
        let moved = frame != self.window;
        self.window = frame;
        moved
    }

    /// The window on its display, for the dimming around it.
    pub(crate) fn frame(&self) -> cg::Rect {
        to_display_relative(self.window, self.display)
    }
}

/// Where a window is now, in screen points; `None` once it's closed.
fn window_frame(window_id: u32) -> Option<cg::Rect> {
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

    /// The size a recording of `rect` comes out at, on a display with `display_scale`.
    pub(crate) fn to_record(rect: cg::Rect, display_scale: f64) -> Self {
        Self::of(rect, capture_scale(rect, display_scale))
    }

    /// The size a recording of `window` comes out at. A window is cut from a capture of its whole
    /// `display`, so the display decides the scale: at 2x a 1x display over 1080p would be captured
    /// at 5K, 60 times a second.
    pub(crate) fn of_window(window: cg::Rect, display: cg::Rect, display_scale: f64) -> Self {
        Self::of(window, capture_scale(display, display_scale))
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

/// Pixels per point to record at: a 1x display is recorded at 2x when that fits in 4K. Video keeps
/// one color for each 2×2 pixels, so at 1x thin text and small icons lose their color. The area
/// picker's size label repeats this rule (`pixelSize` in `lib/picker/area.ts`).
fn capture_scale(rect: cg::Rect, display_scale: f64) -> f64 {
    const MOST_PIXELS: f64 = 3840.0 * 2160.0;
    let fits_at_2x = rect.size.width * rect.size.height * 4.0 <= MOST_PIXELS;
    if display_scale < 2.0 && fits_at_2x {
        2.0
    } else {
        display_scale
    }
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
            // The window's display as macOS draws it, minus every other app's windows: the
            // window looks just as it does on screen, over the desktop, and its menus and other
            // windows show too. The writer crops each frame to the window (see `Follow`).
            let window = find_window(&content, window_id)?;
            let display = display_of(&content, &window)?;
            let app = window.owning_app().context("window has no app")?;
            let filter = sc::ContentFilter::with_display_excluding_apps_excepting_windows(
                &display,
                &other_apps(&content, app.process_id()),
                &ns::Array::new(),
            );
            // The whole display is captured, so it decides the scale (see `of_window`).
            let scale = capture_scale(display.frame(), display_scale(&display));
            let mut plan = plan(filter, &display, window.frame(), None);
            let whole = CaptureSize::of(display.frame(), scale);
            plan.config.set_width(whole.width);
            plan.config.set_height(whole.height);
            plan.size = CaptureSize::of(window.frame(), scale);
            plan.follows = Some(Follow::new(&window, &display, scale));
            plan.sound = Some(without_this_app(&content, &display));
            Ok(plan)
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

fn find_window(content: &sc::ShareableContent, window_id: u32) -> Result<arc::R<sc::Window>> {
    content
        .windows()
        .iter()
        .find(|window| window.id() == window_id)
        .map(|window| window.retained())
        .with_context(|| format!("window {window_id} is gone"))
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
    let size = CaptureSize::to_record(screen_rect, display_scale(display));
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
        sound: None,
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
        return sc::ContentFilter::with_display_excluding_windows(display, &own_windows(content));
    }
    sc::ContentFilter::with_display_excluding_apps_excepting_windows(
        display,
        &ns::Array::from_slice_retained(&own_app),
        &ns::Array::new(),
    )
}

/// Every app with ordinary windows other than `recorded`, and this app: what a window recording
/// leaves out. The desktop, the Dock and the menu bar stay.
fn other_apps(
    content: &sc::ShareableContent,
    recorded: sys::Pid,
) -> arc::R<ns::Array<sc::RunningApp>> {
    let windowed: HashSet<sys::Pid> = content
        .windows()
        .iter()
        .filter(|window| {
            (NORMAL_WINDOW_LAYER..=FLOATING_WINDOW_LAYER).contains(&window.window_layer())
        })
        .filter_map(|window| window.owning_app().map(|app| app.process_id()))
        .chain([own_pid()])
        .filter(|&pid| pid != recorded)
        .collect();
    let apps: Vec<arc::R<sc::RunningApp>> = content
        .apps()
        .iter()
        .filter(|app| windowed.contains(&app.process_id()))
        .map(|app| app.retained())
        .collect();
    ns::Array::from_slice_retained(&apps)
}

/// This app's windows, which no recording shows.
fn own_windows(content: &sc::ShareableContent) -> arc::R<ns::Array<sc::Window>> {
    let own_pid = own_pid();
    let own: Vec<arc::R<sc::Window>> = content
        .windows()
        .iter()
        .filter(|window| window.owning_app().map(|app| app.process_id()) == Some(own_pid))
        .map(|window| window.retained())
        .collect();
    ns::Array::from_slice_retained(&own)
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
    fn capture_scale_should_record_a_1x_display_at_2x_when_it_fits_in_4k() {
        let rect = |width, height| cg::Rect::new(0.0, 0.0, width, height);
        assert_eq!(capture_scale(rect(918.0, 737.0), 1.0), 2.0);
        assert_eq!(capture_scale(rect(1920.0, 1080.0), 1.0), 2.0);
        assert_eq!(capture_scale(rect(2560.0, 1440.0), 1.0), 1.0);
        assert_eq!(capture_scale(rect(1512.0, 982.0), 2.0), 2.0);
    }

    #[test]
    fn own_pid_should_be_this_process() {
        assert_eq!(own_pid(), std::process::id() as sys::Pid);
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
