import type { Phase, RecordingStatus } from "@/lib/bindings";

/** The capture choices the bar remembers between launches. */
export type SavedOptions = {
  cameraId: string | null;
  microphoneId: string | null;
  systemAudio: boolean;
};

export const DEFAULT_OPTIONS: SavedOptions = {
  cameraId: null,
  microphoneId: null,
  systemAudio: false,
};

/** Saved options over the defaults, or the defaults when nothing or nonsense was saved. */
export function parseOptions(saved: string | null): SavedOptions {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(saved ?? "{}") };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

/** The pill's face: the recording controls from start until saved, else setup or its error. */
export function barLayer(phase: Phase, error: string | null) {
  if (phase !== "idle") return "recording";
  return error ? "error" : "setup";
}

/**
 * The time recorded at `now`: Rust's time, counted on from when it arrived while recording, and
 * held still otherwise. A tick from before it arrived adds nothing.
 */
export function elapsedMsAt(
  status: RecordingStatus,
  receivedAt: number,
  now: number,
): number {
  if (status.phase !== "recording") return status.elapsedMs;
  return status.elapsedMs + Math.max(now - receivedAt, 0);
}
