import { type Point, clamp } from "@/lib/geometry";
import { EASE } from "@/lib/time";
import type { ExportZoom } from "@/lib/bindings";
import { FRAME_MS } from "./timeline";
import { type CursorMove, positionAt } from "./cursor";
import {
  outputAt,
  type Region,
  resolveOverlaps,
  settingValue,
  sourceAt,
} from "./regions";

const ZOOM_MS = 600;
const PAN_MS = 600;
const STEP_MS = 1000 / 120;
const EDGE_SHARE = 0.25;
const FOLLOW = { stiffness: 120, damping: 22 };

const MIDDLE = { x: 0.5, y: 0.5 };

export function zoomPath(regions: Region[], moves: CursorMove[] = []) {
  const zooms = resolveOverlaps(regions, "zoom").map((zoom) => ({
    amount: zoom.amount,
    startMs: outputAt(regions, zoom.startMs),
    endMs: outputAt(regions, zoom.endMs),
    centerAt: followed(zoom, regions, moves),
  }));
  return (outputMs: number) => {
    let from = 1;
    let target = 1;
    let since = -Infinity;
    let shown: (typeof zooms)[number] | null = null;
    const scaleAt = (ms: number) =>
      from + (target - from) * ease((ms - since) / ZOOM_MS);
    const now = () => ({
      scale: scaleAt(outputMs),
      target,
      center: shown ? shown.centerAt(outputMs) : MIDDLE,
    });
    for (const zoom of zooms) {
      for (const [ms, scale] of [
        [zoom.startMs, zoom.amount],
        [zoom.endMs, 1],
      ]) {
        if (ms > outputMs) return now();
        from = scaleAt(ms);
        target = scale;
        since = ms;
        shown = zoom;
      }
    }
    return now();
  };
}

function followed(zoom: Region, regions: Region[], moves: CursorMove[]) {
  const startMs = outputAt(regions, zoom.startMs);
  const endMs = outputAt(regions, zoom.endMs);
  const pans = (zoom.path ?? []).map(({ afterMs, x, y }) => ({
    ms: outputAt(regions, zoom.startMs + afterMs) - PAN_MS,
    center: { x, y },
  }));
  const follows =
    moves.length > 0 && settingValue(zoom, "focus") === "Follow cursor";
  const dt = STEP_MS / 1000;
  let wanted = focusCenter(zoom);
  let view = wanted;
  let speed = { x: 0, y: 0 };
  let last: Point | null = null;
  let next = 0;
  const steps: Point[] = [];
  for (let ms = startMs; ms <= endMs; ms += STEP_MS) {
    steps.push(view);
    while (next < pans.length && pans[next].ms <= ms)
      wanted = pans[next++].center;
    const cursor = follows ? positionAt(moves, sourceAt(regions, ms)) : null;
    if (cursor && last && (cursor.x !== last.x || cursor.y !== last.y))
      wanted = keptInView(wanted, cursor, zoom.amount);
    last = cursor;
    const pull = (key: "x" | "y") =>
      FOLLOW.stiffness * (wanted[key] - view[key]) -
      FOLLOW.damping * speed[key];
    speed = { x: speed.x + pull("x") * dt, y: speed.y + pull("y") * dt };
    view = { x: view.x + speed.x * dt, y: view.y + speed.y * dt };
  }
  steps.push(view);
  return (ms: number) => {
    const index = clamp((ms - startMs) / STEP_MS, 0, steps.length - 1);
    const [from, to] = [steps[Math.floor(index)], steps[Math.ceil(index)]];
    const share = index - Math.floor(index);
    return {
      x: from.x + (to.x - from.x) * share,
      y: from.y + (to.y - from.y) * share,
    };
  };
}

function keptInView(center: Point, cursor: Point, amount: number): Point {
  const size = 1 / amount;
  const margin = EDGE_SHARE * size;
  const toward = (share: number, at: number) => {
    const left = share * (1 - size);
    if (at < left + margin) return clamp((at - margin) / (1 - size), 0, 1);
    if (at > left + size - margin)
      return clamp((at - size + margin) / (1 - size), 0, 1);
    return share;
  };
  return { x: toward(center.x, cursor.x), y: toward(center.y, cursor.y) };
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

export function zoomTrack(
  regions: Region[],
  durationMs: number,
  moves: CursorMove[] = [],
): ExportZoom[] {
  const zoomAt = zoomPath(regions, moves);
  const frames = Math.ceil(durationMs / FRAME_MS) + 1;
  return Array.from({ length: frames }, (_, frame) => {
    const { scale, center } = zoomAt(frame * FRAME_MS);
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
