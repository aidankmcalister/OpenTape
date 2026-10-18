export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

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

export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/** With items ordered front to back, this is the one you can see under `point`. */
export function firstUnder<T extends { frame: Rect }>(
  point: Point | null,
  items: T[],
): T | undefined {
  return point ? items.find((item) => contains(item.frame, point)) : undefined;
}

export function relativeTo(rect: Rect, origin: Point): Rect {
  return { ...rect, x: rect.x - origin.x, y: rect.y - origin.y };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The largest size of `ratio` (width / height) that fits inside `bounds`. */
export function fitInside(bounds: Size, ratio: number): Size {
  const width = Math.min(bounds.width, bounds.height * ratio);
  return { width, height: width / ratio };
}

/** A size in points as the recording's pixels: scaled, then rounded down to even, like Rust. */
export function pixelSize(points: Size, scale: number): Size {
  const even = (value: number) => Math.floor((value * scale) / 2) * 2;
  return { width: even(points.width), height: even(points.height) };
}

/** An SVG path for a rectangle with rounded corners, for CSS `clip-path: path(...)`. */
export function roundedRectPath(
  { x, y, width, height }: Rect,
  corner: number,
): string {
  const r = Math.min(corner, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;
  const arc = (toX: number, toY: number) => `A${r} ${r} 0 0 1 ${toX} ${toY}`;
  return [
    `M${x + r} ${y}`,
    `H${right - r}`,
    arc(right, y + r),
    `V${bottom - r}`,
    arc(right - r, bottom),
    `H${x + r}`,
    arc(x, bottom - r),
    `V${y + r}`,
    arc(x + r, y),
    "Z",
  ].join("");
}
