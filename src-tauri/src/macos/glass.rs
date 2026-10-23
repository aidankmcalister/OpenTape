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

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Animation {
    duration_ms: f64,
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

fn round_ends(glass: &NSVisualEffectView, height: f64) {
    if let Some(layer) = glass.layer() {
        layer.setCornerRadius(height / 2.0);
    }
}
