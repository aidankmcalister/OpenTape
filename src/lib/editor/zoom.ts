import { type Point, clamp } from "@/lib/geometry";
import { EASE } from "@/lib/time";
import type { ExportZoom } from "@/lib/bindings";
import { FRAME_MS } from "./timeline";
import { outputAt, type Region, resolveOverlaps } from "./regions";

const ZOOM_MS = 600;
const PAN_MS = 600;

const MIDDLE = { x: 0.5, y: 0.5 };

export function zoomAt(regions: Region[], outputMs: number) {
  let from = 1;
  let target = 1;
  let since = -Infinity;
  let zoom: Region | null = null;
  const scaleAt = (ms: number) =>
    from + (target - from) * ease((ms - since) / ZOOM_MS);
  const now = () => ({
    scale: scaleAt(outputMs),
    target,
    center: zoom ? centerAt(zoom, regions, outputMs) : MIDDLE,
  });
  for (const region of resolveOverlaps(regions, "zoom")) {
    for (const [edgeMs, scale] of [
      [region.startMs, region.amount],
      [region.endMs, 1],
    ]) {
      const ms = outputAt(regions, edgeMs);
      if (ms > outputMs) return now();
      from = scaleAt(ms);
      target = scale;
      since = ms;
      zoom = region;
    }
  }
  return now();
}

function centerAt(zoom: Region, regions: Region[], outputMs: number): Point {
  let center = focusCenter(zoom);
  for (const { afterMs, x, y } of zoom.path ?? []) {
    const arrivesMs = outputAt(regions, zoom.startMs + afterMs);
    const share = ease(clamp((outputMs - arrivesMs + PAN_MS) / PAN_MS, 0, 1));
    if (share === 0) break;
    center = {
      x: center.x + (x - center.x) * share,
      y: center.y + (y - center.y) * share,
    };
  }
  return center;
}

export function focusCenter(zoom: Region): Point {
  return zoom.center ?? MIDDLE;
}

export function focusBox(zoom: Region) {
  const size = 1 / zoom.amount;
  const { x, y } = focusCenter(zoom);
  return { x: x * (1 - size), y: y * (1 - size), size };
}

export function focusAt(box: Point, amount: number): Point {
  const room = 1 - 1 / amount;
  return { x: clamp(box.x / room, 0, 1), y: clamp(box.y / room, 0, 1) };
}

export function zoomTrack(regions: Region[], durationMs: number): ExportZoom[] {
  const frames = Math.ceil(durationMs / FRAME_MS) + 1;
  return Array.from({ length: frames }, (_, frame) => {
    const { scale, center } = zoomAt(regions, frame * FRAME_MS);
    return { scale, ...center };
  });
}

function ease(progress: number): number {
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = EASE;
  const bezier = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step++) {
    const t = (low + high) / 2;
    if (bezier(t, x1, x2) < progress) low = t;
    else high = t;
  }
  return bezier(low, y1, y2);
}

export function focusBoxStyle(zoom: Region) {
  const { x, y, size } = focusBox(zoom);
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${size * 100}%`,
    height: `${size * 100}%`,
  };
}
