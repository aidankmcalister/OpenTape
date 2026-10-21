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
