import { type Point, clamp } from "@/lib/geometry";
import { EASE } from "@/lib/time";
import type { ExportZoom } from "@/lib/bindings";
import { FRAME_MS } from "./timeline";
import {
  type CursorMove,
  type CursorTrack,
  positionAt,
  steadySpots,
  typingStretches,
} from "./cursor";
import {
  outputAt,
  type Region,
  resolveOverlaps,
  settingValue,
  sourceAt,
} from "./regions";

const ZOOM_MS = 600;
const PAN_MS = 750;
const STEP_MS = 1000 / 120;
const STILL_SHARE = 0.015;
const STILL_MS = 300;
const TYPING_HOLD_MS = 1500;
const FOLLOW = {
  stiffness: 200,
  damping: 40,
  mass: 2.25,
  settleMs: 200,
  leadMs: 300,
};
const GROUP = { width: 0.5, height: 0.7 };

const MIDDLE = { x: 0.5, y: 0.5 };
const WHOLE = { x: 1, y: 1 };

type Following = Pick<CursorTrack, "moves" | "keys"> & {
  typed?: CursorMove[];
};

export function zoomPath(
  regions: Region[],
  cursor: Following = { moves: [], keys: [] },
  crop: Point = WHOLE,
  durationMs = 0,
) {
  const floor = Math.max(crop.x, crop.y);
  const zooms = resolveOverlaps(regions, "zoom").map((zoom) => ({
    amount: zoom.amount,
    startMs: outputAt(regions, zoom.startMs),
    endMs: outputAt(regions, zoom.endMs),
    centerAt: followed(zoom, regions, cursor, crop),
  }));
  const baseAt =
    floor > 1
      ? followed(
          {
            id: 0,
            kind: "zoom",
            startMs: 0,
            endMs: durationMs,
            amount: 1,
            settings: { focus: "Follow cursor" },
            path: steadySpots(cursor.typed ?? []).map(({ ms, x, y }) => ({
              afterMs: ms,
              ...centeredOn({ x, y }, floor, crop),
            })),
          },
          regions,
          cursor,
          crop,
        )
      : null;
  return (outputMs: number) => {
    let from = 1;
    let target = 1;
    let since = -Infinity;
    let shown: (typeof zooms)[number] | null = null;
    const scaleAt = (ms: number) =>
      from + (target - from) * ease((ms - since) / ZOOM_MS);
    const now = () => {
      const relative = scaleAt(outputMs);
      const own = shown ? shown.centerAt(outputMs) : MIDDLE;
      if (!baseAt) return { scale: relative, target, center: own };
      const scale = relative * floor;
      const share = shown
        ? clamp((relative - 1) / (shown.amount - 1 || 1), 0, 1)
        : 0;
      const base = baseAt(outputMs);
      const framed = (key: "x" | "y") => {
        const at = base[key] + (own[key] - base[key]) * share;
        const edge = edgeOf(crop[key], scale);
        return (clamp(at, edge, 1 - edge) + (crop[key] - 1) / 2) / crop[key];
      };
      return {
        scale,
        target: target * floor,
        center: { x: framed("x"), y: framed("y") },
      };
    };
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

function followed(
  zoom: Region,
  regions: Region[],
  cursor: Following,
  crop: Point,
) {
  const startMs = outputAt(regions, zoom.startMs);
  const endMs = outputAt(regions, zoom.endMs);
  const aimAt = aims(zoom, regions, cursor, crop);
  const dt = STEP_MS / 1000;
  const settle = Math.min(1, STEP_MS / FOLLOW.settleMs);
  let eased = focusCenter(zoom);
  let view = eased;
  let speed = { x: 0, y: 0 };
  const steps: Point[] = [];
  for (let ms = startMs; ms <= endMs; ms += STEP_MS) {
    steps.push(view);
    const wanted = aimAt(ms);
    eased = {
      x: eased.x + (wanted.x - eased.x) * settle,
      y: eased.y + (wanted.y - eased.y) * settle,
    };
    const pull = (key: "x" | "y") =>
      (FOLLOW.stiffness * (eased[key] - view[key]) -
        FOLLOW.damping * speed[key]) /
      FOLLOW.mass;
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

function aims(
  zoom: Region,
  regions: Region[],
  { moves, keys }: Following,
  crop: Point,
) {
  const amount = zoom.amount * Math.max(crop.x, crop.y);
  const pans = (zoom.path ?? []).map(({ afterMs, x, y }) => ({
    ms: outputAt(regions, zoom.startMs + afterMs) - PAN_MS,
    center: { x, y },
  }));
  const follows =
    moves.length > 0 && settingValue(zoom, "focus") === "Follow cursor";
  const typing = typingStretches(keys);
  const isTyping = (sourceMs: number) =>
    typing.some(
      ({ startMs, endMs }) =>
        sourceMs > startMs - TYPING_HOLD_MS &&
        sourceMs < endMs + TYPING_HOLD_MS,
    );
  let wanted = focusCenter(zoom);
  let group: { min: Point; max: Point } | null = null;
  let next = 0;
  return (ms: number) => {
    while (next < pans.length && pans[next].ms <= ms) {
      wanted = pans[next++].center;
      group = null;
    }
    if (!follows) return wanted;
    if (isTyping(sourceAt(regions, ms))) {
      group = null;
      return wanted;
    }
    const aheadMs = sourceAt(regions, ms + FOLLOW.leadMs);
    const cursor = steadyAt(moves, aheadMs);
    const before = steadyAt(moves, aheadMs - STILL_MS);
    const moved = Math.max(
      Math.abs(cursor.x - before.x),
      Math.abs(cursor.y - before.y),
    );
    if (moved <= STILL_SHARE) return wanted;
    group = grouped(group, cursor, {
      x: crop.x / amount,
      y: crop.y / amount,
    });
    wanted = centeredOn(
      {
        x: (group.min.x + group.max.x) / 2,
        y: (group.min.y + group.max.y) / 2,
      },
      amount,
      crop,
    );
    return wanted;
  };
}

function steadyAt(moves: CursorMove[], ms: number): Point {
  const points = [-100, -50, 0, 50, 100].map((back) =>
    positionAt(moves, ms - back),
  );
  return {
    x: points.reduce((sum, { x }) => sum + x, 0) / points.length,
    y: points.reduce((sum, { y }) => sum + y, 0) / points.length,
  };
}

function grouped(
  group: { min: Point; max: Point } | null,
  cursor: Point,
  size: Point,
) {
  if (!group) return { min: cursor, max: cursor };
  const min = {
    x: Math.min(group.min.x, cursor.x),
    y: Math.min(group.min.y, cursor.y),
  };
  const max = {
    x: Math.max(group.max.x, cursor.x),
    y: Math.max(group.max.y, cursor.y),
  };
  const fits =
    max.x - min.x <= GROUP.width * size.x &&
    max.y - min.y <= GROUP.height * size.y;
  return fits ? { min, max } : { min: cursor, max: cursor };
}

function centeredOn(spot: Point, amount: number, crop: Point): Point {
  const size = 1 / amount;
  const share = (key: "x" | "y") => {
    const edge = edgeOf(crop[key], amount);
    return clamp((spot[key] - size / 2) / (1 - size), edge, 1 - edge);
  };
  return { x: share("x"), y: share("y") };
}

function edgeOf(crop: number, scale: number) {
  return crop > 1 ? (crop - 1) / (2 * (scale - 1)) : 0;
}

export function focusCenter(zoom: Region): Point {
  return zoom.center ?? MIDDLE;
}

export function focusBox(zoom: Region, crop: Point = WHOLE) {
  const scale = zoom.amount * Math.max(crop.x, crop.y);
  const center = focusCenter(zoom);
  const left = (key: "x" | "y") => {
    const edge = edgeOf(crop[key], scale);
    const at = clamp(center[key], edge, 1 - edge);
    return at * (1 - 1 / scale) + (1 - crop[key]) / (2 * scale);
  };
  return {
    x: left("x"),
    y: left("y"),
    width: crop.x / scale,
    height: crop.y / scale,
  };
}

export function focusAt(box: Point, amount: number, crop: Point = WHOLE) {
  const scale = amount * Math.max(crop.x, crop.y);
  const at = (key: "x" | "y") => {
    const edge = edgeOf(crop[key], scale);
    const left = box[key] - (1 - crop[key]) / (2 * scale);
    return clamp(left / (1 - 1 / scale), edge, 1 - edge);
  };
  return { x: at("x"), y: at("y") };
}

export function zoomTrack(
  regions: Region[],
  durationMs: number,
  cursor?: Following,
  crop?: Point,
): ExportZoom[] {
  const zoomAt = zoomPath(regions, cursor, crop, durationMs);
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

export function focusBoxStyle(zoom: Region, crop?: Point) {
  const { x, y, width, height } = focusBox(zoom, crop);
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}
