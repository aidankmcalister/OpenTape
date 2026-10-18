/** The Area box's rules: where it starts, how it drags and resizes, and where its bar sits. */
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

export const MIN_AREA_SIDE = 50;
const DEFAULT_AREA: Size = { width: 1280, height: 720 };
const PANEL_GAP = 12;

export function centeredArea(bounds: Size): Rect {
  const width = Math.min(DEFAULT_AREA.width, bounds.width);
  const height = Math.min(DEFAULT_AREA.height, bounds.height);
  return {
    x: Math.round((bounds.width - width) / 2),
    y: Math.round((bounds.height - height) / 2),
    width,
    height,
  };
}

export function dragArea(
  initial: Rect,
  handle: Handle,
  delta: Point,
  bounds: Size,
): Rect {
  return handle === "move"
    ? moveArea(initial, delta, bounds)
    : resizeArea(initial, handle, delta, bounds);
}

/** The most of the display a ratio change makes the box, so it never swallows the screen. */
const MOST_OF_DISPLAY = 0.85;

/**
 * The box at `ratio`, around the same center and with about the same area, so switching ratios
 * back and forth never grows or shrinks it. Capped to most of the display.
 */
export function fitRatio(area: Rect, ratio: number, bounds: Size): Rect {
  const side = Math.sqrt(area.width * area.height);
  const wide = side * Math.sqrt(ratio);
  const tall = side / Math.sqrt(ratio);
  const shrink = Math.min(
    1,
    (bounds.width * MOST_OF_DISPLAY) / wide,
    (bounds.height * MOST_OF_DISPLAY) / tall,
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
 * room above, below the menu bar and the notch (`safeTop`), it sits just inside the box's top.
 */
export function panelPosition(
  area: Rect,
  panel: Size,
  bounds: Size,
  safeTop = 0,
): Point {
  const above = area.y - PANEL_GAP - panel.height;
  return {
    x: clamp(
      area.x + (area.width - panel.width) / 2,
      PANEL_GAP,
      bounds.width - panel.width - PANEL_GAP,
    ),
    y:
      above >= safeTop + PANEL_GAP
        ? above
        : Math.max(area.y, safeTop) + PANEL_GAP,
  };
}

function moveArea(initial: Rect, delta: Point, bounds: Size): Rect {
  return {
    ...initial,
    x: Math.round(clamp(initial.x + delta.x, 0, bounds.width - initial.width)),
    y: Math.round(
      clamp(initial.y + delta.y, 0, bounds.height - initial.height),
    ),
  };
}

function resizeArea(
  initial: Rect,
  handle: Handle,
  delta: Point,
  bounds: Size,
): Rect {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  if (handle.endsWith("w"))
    left = clamp(left + delta.x, 0, right - MIN_AREA_SIDE);
  if (handle.endsWith("e"))
    right = clamp(right + delta.x, left + MIN_AREA_SIDE, bounds.width);
  if (handle.startsWith("n"))
    top = clamp(top + delta.y, 0, bottom - MIN_AREA_SIDE);
  if (handle.startsWith("s"))
    bottom = clamp(bottom + delta.y, top + MIN_AREA_SIDE, bounds.height);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/** A size in points as the recording's pixels: scaled, then rounded down to even, like Rust. */
export function pixelSize(points: Size, scale: number): Size {
  const even = (value: number) => Math.floor((value * scale) / 2) * 2;
  return { width: even(points.width), height: even(points.height) };
}
