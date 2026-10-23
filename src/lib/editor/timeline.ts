import { clamp } from "@/lib/geometry";

export function percentAt(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(ms / durationMs, 0, 1) * 100;
}

export function msAtX(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

// Capture sends at most 60 a second (`src-tauri/src/capture/plan.rs`).
export const FRAME_MS = 1000 / 60;

// Lands mid-frame so the video shows that frame rather than the one before it.
export function frameStep(
  ms: number,
  frames: number,
  durationMs: number,
): number {
  const frame = Math.floor(ms / FRAME_MS) + frames;
  return clamp((frame + 0.5) * FRAME_MS, 0, durationMs);
}
