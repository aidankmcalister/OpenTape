import { twoDigits } from "@/lib/time";
import { clamp } from "@/lib/geometry";
import type { Region, RegionKind } from "./regions";

export function percentAt(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(ms / durationMs, 0, 1) * 100;
}

export function msAtX(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

export const FRAME_MS = 1000 / 60;

export function frameStep(
  ms: number,
  frames: number,
  durationMs: number,
): number {
  const frame = Math.floor(ms / FRAME_MS) + frames;
  return clamp((frame + 0.5) * FRAME_MS, 0, durationMs);
}

export const GUTTER_PX = 152;
export const MIN_BLOCK_PX = 40;
export const TRACKS_TOP_PX = 68;
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

export type BlockContent = "full" | "value" | "icon";

export function blockContent(
  widthPx: number,
  label: string,
  value: string,
): BlockContent {
  const withValue = 46 + 7 * value.length;
  if (widthPx >= withValue + 10 + 7 * label.length) return "full";
  return widthPx >= withValue ? "value" : "icon";
}

const MIN_LABEL_GAP_PX = 96;

export function rulerMarks(durationMs: number, widthPx: number) {
  const pxPerSecond = widthPx / Math.max(durationMs / 1000, 0.001);
  const stepS =
    [1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (step) => step * pxPerSecond >= MIN_LABEL_GAP_PX,
    ) ?? 600;
  const halfStepMs = (stepS * 1000) / 2;
  const marks: { ms: number; isMajor: boolean }[] = [];
  for (let i = 0; i * halfStepMs <= durationMs; i++) {
    marks.push({ ms: i * halfStepMs, isMajor: i % 2 === 0 });
  }
  return marks;
}

export function rulerLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${twoDigits(totalSeconds % 60)}`;
}

export function lengthLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
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
