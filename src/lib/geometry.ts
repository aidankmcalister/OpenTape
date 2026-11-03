import type { Point } from "@/lib/bindings";

export type { Point };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
export type RoundedRect = Rect & { corner: number };

export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function relativeTo<T extends Rect>(rect: T, origin: Point): T {
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

export function rectStyle(rect: Rect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

export function percentStyle(rect: Rect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

export function fitInside(bounds: Size, ratio: number): Size {
  const width = Math.min(bounds.width, bounds.height * ratio);
  return { width, height: width / ratio };
}
