//! The frosted glass behind a see-through pill: the record bar's, and the capture bar in the
//! picker's overlays. A page can only blur its own content, so the glass is a native view that
//! blurs the apps behind the window. It's owned here, rather than through Tauri's window effects,
//! so it can follow the pill: changing shape with the bar's animation, or moving with the overlay's
//! capture bar.

use objc2::{MainThreadMarker, MainThreadOnly, rc::Retained};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::CAMediaTimingFunction;
use serde::Deserialize;

/// How the pill animates, sent by the frontend so the glass moves on exactly the same curve.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    duration_ms: f64,
    /// A CSS `cubic-bezier` curve's four control values.
    ease: [f32; 4],
}

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

/// Sizes the glass to the pill, centered in the window, animating when given an animation.
pub fn shape(ns_window: &NSWindow, pill: NSSize, animation: Option<Animation>) {
    let (Some(glass), Some(content)) = (find(ns_window), ns_window.contentView()) else {
        return;
    };
    if let Some(layer) = glass.layer() {
        layer.setCornerRadius(pill.height / 2.0);
    }
    let frame = centered(content.bounds().size.width, pill);
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

fn find(ns_window: &NSWindow) -> Option<Retained<NSVisualEffectView>> {
    ns_window
        .contentView()?
        .subviews()
        .into_iter()
        .find_map(|view| view.downcast::<NSVisualEffectView>().ok())
}

/// Puts the glass under a pill anywhere in the window, or hides it with `None`. `pill` is in page
/// points from the top-left, like the frontend measures it.
pub fn place(ns_window: &NSWindow, main_thread: MainThreadMarker, pill: Option<NSRect>) {
    if find(ns_window).is_none() {
        add(ns_window, main_thread);
    }
    let (Some(glass), Some(content)) = (find(ns_window), ns_window.contentView()) else {
        return;
    };
    let Some(pill) = pill else {
        glass.setHidden(true);
        return;
    };
    if let Some(layer) = glass.layer() {
        layer.setCornerRadius(pill.size.height / 2.0);
    }
    let height = content.bounds().size.height;
    glass.setFrame(if content.isFlipped() {
        pill
    } else {
        from_bottom(pill, height)
    });
    glass.setHidden(false);
}

/// The window is exactly as tall as the pill, so only the horizontal position varies.
fn centered(window_width: f64, pill: NSSize) -> NSRect {
    NSRect::new(NSPoint::new((window_width - pill.width) / 2.0, 0.0), pill)
}

/// macOS measures views from the bottom-left, while pages measure from the top-left.
fn from_bottom(rect: NSRect, height: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(rect.origin.x, height - rect.origin.y - rect.size.height),
        rect.size,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_bottom_should_flip_a_top_left_rect() {
        let rect = NSRect::new(NSPoint::new(10.0, 20.0), NSSize::new(100.0, 40.0));
        assert_eq!(from_bottom(rect, 800.0).origin.y, 740.0);
    }

    #[test]
    fn centered_should_put_the_pill_in_the_middle() {
        let frame = centered(1000.0, NSSize::new(200.0, 58.0));
        assert_eq!(frame.origin.x, 400.0);
        assert_eq!(frame.size.width, 200.0);
    }
}
