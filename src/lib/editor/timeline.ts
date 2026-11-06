import { twoDigits } from "@/lib/time";
import { clamp } from "@/lib/geometry";
import { ALL_KINDS, type Region, type RegionKind } from "./regions";

export function percentAt(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(ms / durationMs, 0, 1) * 100;
}

export function msAtX(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

const MIN_VIEW_MS = 5000;
const FOLLOW_EDGE_PX = 40;

export function maxZoom(lengthMs: number): number {
  return Math.max(1, lengthMs / MIN_VIEW_MS);
}

export function zoomAround(
  zoom: number,
  factor: number,
  anchorPx: number,
  scrollPx: number,
  lengthMs: number,
) {
  const next = clamp(zoom * factor, 1, maxZoom(lengthMs));
  return {
    zoom: next,
    scrollPx: Math.max(0, ((scrollPx + anchorPx) * next) / zoom - anchorPx),
  };
}

export function followScroll(
  playheadPx: number,
  scrollPx: number,
  viewportPx: number,
): number {
  const isShown =
    playheadPx >= scrollPx &&
    playheadPx <= scrollPx + viewportPx - FOLLOW_EDGE_PX;
  return isShown ? scrollPx : Math.max(0, playheadPx - FOLLOW_EDGE_PX);
}

export const FRAME_MS = 1000 / 60;
export const STEP_MS = 1000 / 120;

export function frameStep(
  ms: number,
  frames: number,
  durationMs: number,
): number {
  const frame = Math.floor(ms / FRAME_MS) + frames;
  return clamp((frame + 0.5) * FRAME_MS, 0, durationMs);
}

export const GUTTER_PX = 152;
export const TRACKS_TOP_PX = 64;
export const TRACK_INSET_PX = 8;

const LANE_PX = 32;
const COLLAPSED_LANE_PX = 20;
const EMPTY_LANES_PX = 64;

export type Lane = {
  kind: RegionKind;
  top: number;
  height: number;
  isCollapsed: boolean;
};

export function laneLayout(kinds: RegionKind[], collapsed: RegionKind[]) {
  let top = 0;
  const lanes = kinds.map((kind): Lane => {
    const isCollapsed = collapsed.includes(kind);
    const lane = {
      kind,
      top,
      height: isCollapsed ? COLLAPSED_LANE_PX : LANE_PX,
      isCollapsed,
    };
    top += lane.height;
    return lane;
  });
  const heightPx = lanes.length ? top : EMPTY_LANES_PX;
  return { lanes, heightPx };
}

export type BlockFit = "full" | "compact" | "icon" | "mark";

export function blockFit(widthPx: number): BlockFit {
  if (widthPx >= 160) return "full";
  if (widthPx >= 72) return "compact";
  return widthPx >= 24 ? "icon" : "mark";
}

export function laneNeighbors(regions: Region[], region: Region) {
  const others = regions.filter(
    (other) => other.kind === region.kind && other !== region,
  );
  const before = others.filter(({ endMs }) => endMs <= region.startMs);
  const after = others.filter(({ startMs }) => startMs >= region.endMs);
  return {
    beforeMs: Math.max(-Infinity, ...before.map(({ endMs }) => endMs)),
    afterMs: Math.min(Infinity, ...after.map(({ startMs }) => startMs)),
  };
}

const MARK_MIN_PX = 3;
const MARK_HIT_PX = 12;

export function markSpan(
  startPx: number,
  endPx: number,
  beforePx: number,
  afterPx: number,
) {
  const middle = (startPx + endPx) / 2;
  const from = Math.max(
    Math.min(startPx, middle - MARK_HIT_PX / 2),
    (beforePx + startPx) / 2,
  );
  const to = Math.min(
    Math.max(endPx, middle + MARK_HIT_PX / 2),
    (endPx + afterPx) / 2,
  );
  const widthPx = Math.max(MARK_MIN_PX, endPx - startPx);
  return { from, to, markFrom: middle - widthPx / 2, widthPx };
}

const MIN_LABEL_GAP_PX = 96;
const DOTS_PER_LABEL = 5;

export function rulerMarks(durationMs: number, widthPx: number) {
  const pxPerSecond = widthPx / Math.max(durationMs / 1000, 0.001);
  const stepS =
    [1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (step) => step * pxPerSecond >= MIN_LABEL_GAP_PX,
    ) ?? 600;
  const dotMs = (stepS * 1000) / DOTS_PER_LABEL;
  const marks: { ms: number; isMajor: boolean }[] = [];
  for (let i = 0; i * dotMs <= durationMs; i++) {
    marks.push({ ms: i * dotMs, isMajor: i % DOTS_PER_LABEL === 0 });
  }
  return marks;
}

export function rulerLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${twoDigits(totalSeconds % 60)}`;
}

const CHAR_PX = 7;
const LABEL_GAP_PX = 6;
const CHIP_HALF_PX = 30;
const AXIS_ROOM_PX = 8;

export function rulerLabels(durationMs: number, widthPx: number) {
  let shownEnd = -Infinity;
  return rulerMarks(durationMs, widthPx)
    .filter(({ isMajor }) => isMajor)
    .map(({ ms }) => {
      const x = (percentAt(ms, durationMs) / 100) * widthPx;
      const text = rulerLabel(ms);
      const textPx = CHAR_PX * text.length;
      const from = Math.max(0, Math.min(x - textPx / 2, widthPx - textPx));
      const isCrowded = from < shownEnd + LABEL_GAP_PX;
      if (!isCrowded) shownEnd = from + textPx;
      return { ms, text, from, to: from + textPx, isCrowded };
    });
}

export function chipShift(x: number, widthPx: number): number {
  const first = CHIP_HALF_PX - AXIS_ROOM_PX;
  const last = widthPx + AXIS_ROOM_PX - CHIP_HALF_PX;
  return Math.max(first, Math.min(x, last)) - x;
}

export function nextBlock(
  regions: Region[],
  lanes: Lane[],
  region: Region,
  step: "next" | "previous" | "up" | "down",
): Region | undefined {
  if (step === "next" || step === "previous") {
    const order = blockOrder(regions);
    return order[order.indexOf(region) + (step === "next" ? 1 : -1)];
  }
  const at = lanes.findIndex(({ kind }) => kind === region.kind);
  const lane = lanes[at + (step === "down" ? 1 : -1)];
  return regions
    .filter(({ kind }) => kind === lane?.kind)
    .sort(
      (a, b) =>
        Math.abs(a.startMs - region.startMs) -
        Math.abs(b.startMs - region.startMs),
    )[0];
}

export function blockOrder(regions: Region[]): Region[] {
  return [...regions].sort(
    (a, b) =>
      a.startMs - b.startMs ||
      ALL_KINDS.indexOf(a.kind) - ALL_KINDS.indexOf(b.kind),
  );
}

export function lengthLabel(ms: number): string {
  return Math.round(ms / 100) < 600
    ? `${(ms / 1000).toFixed(1)}s`
    : rulerLabel(ms);
}

export function timeLabel(ms: number): string {
  const tenths = Math.round(ms / 100);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${twoDigits(seconds % 60)}.${tenths % 10}`;
}

export function parseTimeLabel(text: string): number {
  const [minutes, seconds] = text.includes(":")
    ? text.split(":").map(Number.parseFloat)
    : [0, Number.parseFloat(text)];
  return (minutes * 60 + seconds) * 1000;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

export function regionsInBox(
  regions: Region[],
  box: Box,
  width: number,
  durationMs: number,
  lanes: Lane[],
): number[] {
  const startMs = msAtX(Math.min(box.x0, box.x1), width, durationMs);
  const endMs = msAtX(Math.max(box.x0, box.x1), width, durationMs);
  const minY = Math.min(box.y0, box.y1);
  const maxY = Math.max(box.y0, box.y1);
  const touched = lanes
    .filter(({ top, height }) => top < maxY && top + height > minY)
    .map(({ kind }) => kind);
  return regions
    .filter(
      ({ startMs: start, endMs: end, kind }) =>
        start < endMs && end > startMs && touched.includes(kind),
    )
    .map(({ id }) => id);
}
