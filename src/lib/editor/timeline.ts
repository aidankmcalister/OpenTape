import { clamp } from "@/lib/geometry";

/** Where `ms` sits along a recording of `durationMs`, as a percentage from 0 to 100. */
export function percentAt(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(ms / durationMs, 0, 1) * 100;
}

/** The time under a pointer `x` pixels into a timeline `width` pixels wide, kept inside the recording. */
export function msAtX(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

/** One frame of a recording. Capture sends at most 60 a second (`src-tauri/src/capture/plan.rs`). */
export const FRAME_MS = 1000 / 60;

/**
 * The time `frames` frames on from `ms`, kept inside the recording. It lands in the middle of the
 * frame, so the video shows that frame for sure rather than the one before it.
 */
export function frameStep(
  ms: number,
  frames: number,
  durationMs: number,
): number {
  const frame = Math.floor(ms / FRAME_MS) + frames;
  return clamp((frame + 0.5) * FRAME_MS, 0, durationMs);
}
