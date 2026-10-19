//! Turns what to record (a display, a window or an area) into what ScreenCaptureKit needs: a
//! content filter that leaves out the right windows, a stream config, and the output size.

use anyhow::{Context, Result};
use cidre::{arc, cg, cm, ns, sc, sys};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::content::{display_of, display_scale, find_display, find_window, shareable_content};
use crate::geometry::{on_screen, relative_to};

const FRAMES_PER_SECOND: i32 = 60;
const BITS_PER_PIXEL_PER_SECOND: usize = 8;

/// What to record. Sent from the frontend as `{ kind: "window", windowId: 398 }` and so on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
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
    /// A rectangle in points, measured from the display's top-left corner.
    Area {
        display_id: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

/// Everything needed to start a capture, whatever the target.
pub(super) struct CapturePlan {
    pub filter: arc::R<sc::ContentFilter>,
    pub cfg: arc::R<sc::StreamCfg>,
    pub size: CaptureSize,
    /// Where the captured content was on screen at the start, in global points.
    pub screen_rect: cg::Rect,
}

/// A recording's size in pixels: what the file will be, and what the picker shows. Always even,
/// because H.264 needs even dimensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub(crate) struct CaptureSize {
    pub(super) width: usize,
    pub(super) height: usize,
}

impl CaptureSize {
    pub(crate) fn of(rect: cg::Rect, scale: f64) -> Self {
        Self {
            width: even_pixels(rect.size.width, scale),
            height: even_pixels(rect.size.height, scale),
        }
    }

    pub(super) fn bitrate(self) -> i64 {
        (self.width * self.height * BITS_PER_PIXEL_PER_SECOND) as i64
    }
}

pub(super) fn plan_capture(target: &Target) -> Result<CapturePlan> {
    let content = shareable_content()?;
    match *target {
        Target::Display { display_id } => {
            let display = find_display(&content, display_id)?;
            let screen_rect = display.frame();
            let size = CaptureSize::of(screen_rect, display_scale(&display));
            Ok(CapturePlan {
                filter: without_this_app(&content, &display),
                cfg: stream_config(size),
                size,
                screen_rect,
            })
        }
        Target::Window { window_id } => {
            let window = find_window(&content, window_id)?;
            let display = display_of(&content, &window)?;
            let app = window.owning_app().context("window has no app")?;
            let screen_rect = window.frame();
            let size = CaptureSize::of(screen_rect, display_scale(&display));
            let mut cfg = stream_config(size);
            cfg.set_src_rect(relative_to(screen_rect, display.frame()));
            Ok(CapturePlan {
                filter: sc::ContentFilter::with_display_excluding_windows(
                    &display,
                    &hidden_windows(&content, Hiding::of(Some(app.process_id()))),
                ),
                cfg,
                size,
                screen_rect,
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
            let rect = cg::Rect::new(x, y, width, height);
            let size = CaptureSize::of(rect, display_scale(&display));
            let mut cfg = stream_config(size);
            cfg.set_src_rect(rect);
            Ok(CapturePlan {
                filter: without_this_app(&content, &display),
                cfg,
                size,
                screen_rect: on_screen(rect, display.frame()),
            })
        }
    }
}

/// The whole display without this app, including windows it opens after capture starts, like
/// the frame and alerts. Falls back to leaving out this app's current windows.
fn without_this_app(
    content: &sc::ShareableContent,
    display: &sc::Display,
) -> arc::R<sc::ContentFilter> {
    let own_pid = Hiding::of(None).own_pid;
    let own_app: Vec<arc::R<sc::RunningApp>> = content
        .apps()
        .iter()
        .filter(|app| app.process_id() == own_pid)
        .map(|app| app.retained())
        .collect();
    if own_app.is_empty() {
        return sc::ContentFilter::with_display_excluding_windows(
            display,
            &hidden_windows(content, Hiding::of(None)),
        );
    }
    sc::ContentFilter::with_display_excluding_apps_excepting_windows(
        display,
        &ns::Array::from_slice_retained(&own_app),
        &ns::Array::new(),
    )
}

/// Every other app's normal windows (layer 0). Window recordings hide these, so windows
/// dragged over the recorded one don't show, while dragged items and menus still do.
fn hidden_windows(content: &sc::ShareableContent, hiding: Hiding) -> arc::R<ns::Array<sc::Window>> {
    let hidden: Vec<arc::R<sc::Window>> = content
        .windows()
        .iter()
        .filter(|window| {
            let owner = window.owning_app().map(|app| app.process_id());
            hiding.hides(window.window_layer(), owner)
        })
        .map(|window| window.retained())
        .collect();
    ns::Array::from_slice_retained(&hidden)
}

/// Which windows a capture leaves out.
#[derive(Debug, Clone, Copy)]
struct Hiding {
    own_pid: sys::Pid,
    /// Set when recording a window: the app that owns it.
    recorded_app: Option<sys::Pid>,
}

impl Hiding {
    fn of(recorded_app: Option<sys::Pid>) -> Self {
        Self {
            // A macOS process ID always fits. If it didn't, -1 matches no app.
            own_pid: sys::Pid::try_from(std::process::id()).unwrap_or(-1),
            recorded_app,
        }
    }

    /// This app's windows (the bar, the overlays) never show. When recording a window, other
    /// apps' normal windows (layer 0) hide too; higher layers (drags, menus, tooltips) stay.
    fn hides(self, layer: isize, owner: Option<sys::Pid>) -> bool {
        let Some(owner) = owner else {
            return false;
        };
        owner == self.own_pid
            || self
                .recorded_app
                .is_some_and(|app| layer == 0 && owner != app)
    }
}

fn stream_config(size: CaptureSize) -> arc::R<sc::StreamCfg> {
    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(size.width);
    cfg.set_height(size.height);
    cfg.set_shows_cursor(false);
    cfg.set_minimum_frame_interval(cm::Time::new(1, FRAMES_PER_SECOND));
    cfg
}

/// Points times screen scale, rounded down to an even number of pixels.
fn even_pixels(points: f64, scale: f64) -> usize {
    (points * scale) as usize / 2 * 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_should_read_a_window_from_the_frontend() {
        let target: Target = serde_json::from_str(r#"{"kind":"window","windowId":398}"#).unwrap();
        assert_eq!(target, Target::Window { window_id: 398 });
    }

    #[test]
    fn target_should_read_an_area_from_the_frontend() {
        let json = r#"{"kind":"area","displayId":1,"x":100,"y":50,"width":1280,"height":720}"#;
        let target: Target = serde_json::from_str(json).unwrap();
        assert_eq!(
            target,
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
    fn window_recording_should_hide_other_apps_normal_windows() {
        assert!(RECORDING_APP_100.hides(0, Some(200)));
    }

    #[test]
    fn window_recording_should_keep_the_target_apps_windows() {
        assert!(!RECORDING_APP_100.hides(0, Some(100)));
    }

    #[test]
    fn window_recording_should_keep_higher_layers_like_drags_and_menus() {
        assert!(!RECORDING_APP_100.hides(101, Some(200)));
    }

    #[test]
    fn every_recording_should_hide_this_apps_own_windows() {
        assert!(RECORDING_APP_100.hides(101, Some(1)));
        assert!(RECORDING_DISPLAY.hides(25, Some(1)));
        assert!(!RECORDING_DISPLAY.hides(0, Some(200)));
    }

    const RECORDING_APP_100: Hiding = Hiding {
        own_pid: 1,
        recorded_app: Some(100),
    };
    const RECORDING_DISPLAY: Hiding = Hiding {
        own_pid: 1,
        recorded_app: None,
    };

    #[test]
    fn even_pixels_should_round_down_to_even() {
        assert_eq!(even_pixels(920.5, 2.0), 1840);
    }
}
