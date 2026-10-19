/** The Area box's geometry, and where its capture bar sits. */
import { clamp, type Point, type Rect, type Size } from "@/lib/geometry";

/** A resize handle by compass direction, or "move" for dragging the whole box. */
export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type Ratio = { label: string; value: number };

export const RATIOS: Ratio[] = [
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
  { label: "9:16", value: 9 / 16 },
];

const MIN_SIDE = 50;
/** Room between the capture bar and the box or the display's edges. */
const BAR_GAP = 12;

/** A 1280×720 box in the middle of the display, or the whole of a smaller one. */
export function centeredArea(bounds: Size): Rect {
  const width = Math.min(1280, bounds.width);
  const height = Math.min(720, bounds.height);
  return {
    x: Math.round((bounds.width - width) / 2),
    y: Math.round((bounds.height - height) / 2),
    width,
    height,
  };
}

/** The box after dragging `handle` by `delta`, kept on the display and at least 50 points a side. */
export function dragArea(
  initial: Rect,
  handle: Handle,
  delta: Point,
  bounds: Size,
): Rect {
  if (handle === "move") {
    return {
      ...initial,
      x: Math.round(
        clamp(initial.x + delta.x, 0, bounds.width - initial.width),
      ),
      y: Math.round(
        clamp(initial.y + delta.y, 0, bounds.height - initial.height),
      ),
    };
  }
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  if (handle.endsWith("w")) left = clamp(left + delta.x, 0, right - MIN_SIDE);
  if (handle.endsWith("e"))
    right = clamp(right + delta.x, left + MIN_SIDE, bounds.width);
  if (handle.startsWith("n")) top = clamp(top + delta.y, 0, bottom - MIN_SIDE);
  if (handle.startsWith("s"))
    bottom = clamp(bottom + delta.y, top + MIN_SIDE, bounds.height);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/**
 * The box at `ratio`, around the same center and with about the same area, so switching ratios
 * back and forth never grows or shrinks it. Capped to 85% of the display, so it never swallows
 * the screen.
 */
export function fitRatio(area: Rect, ratio: number, bounds: Size): Rect {
  const side = Math.sqrt(area.width * area.height);
  const wide = side * Math.sqrt(ratio);
  const tall = side / Math.sqrt(ratio);
  const shrink = Math.min(
    1,
    (bounds.width * 0.85) / wide,
    (bounds.height * 0.85) / tall,
  );
  const width = Math.round(wide * shrink);
  const height = Math.round(tall * shrink);
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;
  return {
    x: Math.round(clamp(centerX - width / 2, 0, bounds.width - width)),
    y: Math.round(clamp(centerY - height / 2, 0, bounds.height - height)),
    width,
    height,
  };
}

/**
 * Centered above the box, clear of the record bar at the bottom of the screen. When there's no
 * room above, below the menu bar and the notch (`safeTop`), it sits inside the box's top edge.
 */
export function captureBarPosition(
  area: Rect,
  bar: Size,
  bounds: Size,
  safeTop = 0,
): Point {
  const above = area.y - BAR_GAP - bar.height;
  return {
    x: clamp(
      area.x + (area.width - bar.width) / 2,
      BAR_GAP,
      bounds.width - bar.width - BAR_GAP,
    ),
    y: above >= safeTop + BAR_GAP ? above : Math.max(area.y, safeTop) + BAR_GAP,
  };
}

/**
 * The Area box's size in pixels, live while you drag it: scaled by the display's `scale`, then
 * each side rounded down to even, because H.264 needs even sizes. Rust's `CaptureSize::of` sizes
 * the recording by the same rule, and the tests share their cases, so what the bar shows is what
 * gets recorded. Displays and windows come with their sizes from Rust.
 */
export function pixelSize(points: Size, scale: number): Size {
  const even = (value: number) => Math.floor((value * scale) / 2) * 2;
  return { width: even(points.width), height: even(points.height) };
}
