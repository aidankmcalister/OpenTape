//! What's on screen, as ScreenCaptureKit sees it: the displays and windows that can be
//! captured, and lookups into them.

use anyhow::{Context, Result, anyhow};
use cidre::{arc, ns, sc};

pub(crate) fn shareable_content() -> Result<arc::R<sc::ShareableContent>> {
    pollster::block_on(sc::ShareableContent::current())
        .map_err(|err| anyhow!("could not read the screen (is Screen Recording allowed?): {err:?}"))
}

pub(super) fn find_window(
    content: &sc::ShareableContent,
    window_id: u32,
) -> Result<arc::R<sc::Window>> {
    content
        .windows()
        .iter()
        .find(|window| window.id() == window_id)
        .map(|window| window.retained())
        .with_context(|| format!("window {window_id} is gone"))
}

pub(super) fn find_display(
    content: &sc::ShareableContent,
    display_id: u32,
) -> Result<arc::R<sc::Display>> {
    content
        .displays()
        .iter()
        .find(|display| display.display_id().0 == display_id)
        .map(|display| display.retained())
        .with_context(|| format!("display {display_id} is gone"))
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
