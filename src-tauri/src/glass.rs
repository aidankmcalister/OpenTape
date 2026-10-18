//! The frosted glass behind the bar's pill. The bar owns this view, rather than using Tauri's
//! window effects, so the glass can change shape in step with the pill's CSS animation.

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::CAMediaTimingFunction;

/// The same duration and curve as the pill's CSS transition.
const DURATION_SECONDS: f64 = 0.4;
const EASE_OUT: (f32, f32, f32, f32) = (0.32, 0.72, 0.0, 1.0);

pub fn add(ns_window: &NSWindow, main_thread: MainThreadMarker) {
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

/// Sizes the glass to the pill, centered in the window, animating when asked.
pub fn shape(ns_window: &NSWindow, pill: NSSize, animate: bool) {
    let (Some(glass), Some(content)) = (find(ns_window), ns_window.contentView()) else {
        return;
    };
    if let Some(layer) = glass.layer() {
        layer.setCornerRadius(pill.height / 2.0);
    }
    let frame = centered(content.bounds().size.width, pill);
    if !animate {
        glass.setFrame(frame);
        return;
    }
    NSAnimationContext::beginGrouping();
    let context = NSAnimationContext::currentContext();
    context.setDuration(DURATION_SECONDS);
    let (x1, y1, x2, y2) = EASE_OUT;
    context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
        x1, y1, x2, y2,
    )));
    glass.animator().setFrame(frame);
    NSAnimationContext::endGrouping();
}

fn find(ns_window: &NSWindow) -> Option<Retained<NSVisualEffectView>> {
    ns_window
        .contentView()?
        .subviews()
        .into_iter()
        .find_map(|view| view.downcast::<NSVisualEffectView>().ok())
}

/// The window is exactly as tall as the pill, so only the horizontal position varies.
fn centered(window_width: f64, pill: NSSize) -> NSRect {
    NSRect::new(NSPoint::new((window_width - pill.width) / 2.0, 0.0), pill)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centered_should_put_the_pill_in_the_middle() {
        let frame = centered(1000.0, NSSize::new(200.0, 58.0));
        assert_eq!(frame.origin.x, 400.0);
        assert_eq!(frame.size.width, 200.0);
    }
}
