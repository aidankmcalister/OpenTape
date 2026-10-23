import { twoDigits } from "@/lib/time";
import { clamp } from "@/lib/geometry";

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
