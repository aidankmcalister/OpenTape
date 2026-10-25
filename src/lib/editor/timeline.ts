import { twoDigits } from "@/lib/time";
import { clamp } from "@/lib/geometry";
import type { Region } from "./regions";

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

export type RowBox = { top: number; height: number };

const ROW_PX = 24;
const ROW_GAP_PX = 4;

export const MODIFIERS_TOP_PX = 60;

export const TIMELINE_LIMIT_PX = { min: 128, initial: 184, chromePx: 104 };

export function rowLayout(rowCount: number) {
  const rows: RowBox[] = Array.from(
    { length: Math.max(1, rowCount) },
    (_, row) => ({ top: row * (ROW_PX + ROW_GAP_PX), height: ROW_PX }),
  );
  const last = rows[rows.length - 1];
  return { rows, areaPx: last.top + last.height };
}

export function modifiersWindowPx(rowCount: number, limitPx: number): number {
  const { areaPx } = rowLayout(rowCount);
  return Math.min(areaPx, limitPx - TIMELINE_LIMIT_PX.chromePx);
}

export function rowAtY(rows: RowBox[], y: number): number {
  const index = rows.findIndex(({ top, height }) => y < top + height + 2);
  return index === -1 ? rows.length : index;
}

export type BlockContent = "full" | "compact" | "icon" | "bar";

export function blockContent(
  widthPx: number,
  label: string,
  value: string,
): BlockContent {
  if (widthPx < 48) return "bar";
  if (widthPx >= 76 + 7 * (label.length + value.length)) return "full";
  return widthPx >= 56 + 7 * value.length ? "compact" : "icon";
}

export function rulerMarks(durationMs: number) {
  const durationS = durationMs / 1000;
  const stepS =
    [1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (step) => durationS / step <= 10,
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
  rows: RowBox[],
): number[] {
  const startMs = msAtX(Math.min(box.x0, box.x1), width, durationMs);
  const endMs = msAtX(Math.max(box.x0, box.x1), width, durationMs);
  const minY = Math.min(box.y0, box.y1);
  const maxY = Math.max(box.y0, box.y1);
  const touched = rows.flatMap(({ top, height }, row) =>
    top < maxY && top + height > minY ? [row] : [],
  );
  return regions
    .filter(
      ({ startMs: start, endMs: end, row = 0 }) =>
        start < endMs && end > startMs && touched.includes(row),
    )
    .map(({ id }) => id);
}
