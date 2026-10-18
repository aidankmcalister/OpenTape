import type { Point } from "@/lib/bindings/Point";

export type { Point };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The largest size of `ratio` (width / height) that fits inside `bounds`. */
export function fitInside(bounds: Size, ratio: number): Size {
  const width = Math.min(bounds.width, bounds.height * ratio);
  return { width, height: width / ratio };
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
