//! The frosted glass behind a see-through pill: the record bar's, and the capture bar in the
//! picker's overlays. A page can only blur its own content, so the glass is a native view that
//! blurs the apps behind the window, and it follows the pill as it changes shape or moves.

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowOrderingMode,
};
use objc2_foundation::{NSRect, NSSize};
use objc2_quartz_core::CAMediaTimingFunction;
use serde::Deserialize;
use ts_rs::TS;

use crate::geometry;

/// How the pill animates, sent by the frontend so the glass moves on exactly the same curve.
#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Animation {
    duration_ms: f64,
    /// A CSS `cubic-bezier` curve's four control values.
    ease: [f32; 4],
}

pub(crate) fn add(ns_window: &NSWindow, main_thread: MainThreadMarker) {
    let Some(content) = ns_window.contentView() else {
        return;
    };
    let glass =
        NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(main_thread), NSRect::ZERO);
    glass.setMaterial(NSVisualEffectMaterial::HUDWindow);
    glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    glass.setState(NSVisualEffectState::Active);
    glass.setWantsLayer(true);
    if let Some(layer) = glass.layer() {
        layer.setMasksToBounds(true);
    }
    content.addSubview_positioned_relativeTo(&glass, NSWindowOrderingMode::Below, None);
}

/// Sizes the glass to the pill, centered at the bottom of the window (which is as tall as the
/// pill), animating when given an animation.
pub(crate) fn shape(ns_window: &NSWindow, pill: NSSize, animation: Option<Animation>) {
    let (Some(glass), Some(content)) = (find_glass(ns_window), ns_window.contentView()) else {
        return;
    };
    round_ends(&glass, pill.height);
    let frame = geometry::keep_bottom_center(content.bounds(), pill);
    let Some(Animation { duration_ms, ease }) = animation else {
        glass.setFrame(frame);
        return;
    };
    // Moves the glass on the same curve the page animates the pill with.
    NSAnimationContext::beginGrouping();
    let context = NSAnimationContext::currentContext();
    context.setDuration(duration_ms / 1000.0);
    let [x1, y1, x2, y2] = ease;
    context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
        x1, y1, x2, y2,
    )));
    glass.animator().setFrame(frame);
    NSAnimationContext::endGrouping();
}

/// Puts the glass under a pill anywhere in the window, or hides it with `None`. `pill` is in page
/// points from the top-left, like the frontend measures it.
pub(crate) fn place(ns_window: &NSWindow, main_thread: MainThreadMarker, pill: Option<NSRect>) {
    if find_glass(ns_window).is_none() {
        add(ns_window, main_thread);
    }
    let (Some(glass), Some(content)) = (find_glass(ns_window), ns_window.contentView()) else {
        return;
    };
    let Some(pill) = pill else {
        glass.setHidden(true);
        return;
    };
    round_ends(&glass, pill.size.height);
    let height = content.bounds().size.height;
    // macOS measures views from the bottom-left, unless the view is flipped.
    glass.setFrame(if content.isFlipped() {
        pill
    } else {
        geometry::flip(pill, height)
    });
    glass.setHidden(false);
}

fn find_glass(ns_window: &NSWindow) -> Option<Retained<NSVisualEffectView>> {
    ns_window
        .contentView()?
        .subviews()
        .into_iter()
        .find_map(|view| view.downcast::<NSVisualEffectView>().ok())
}

/// Rounds the glass into a pill `height` tall, with half-circle ends.
fn round_ends(glass: &NSVisualEffectView, height: f64) {
    if let Some(layer) = glass.layer() {
        layer.setCornerRadius(height / 2.0);
    }
}
