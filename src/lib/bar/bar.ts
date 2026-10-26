import type { Phase, RecordingStatus } from "@/lib/bindings";

type SavedOptions = {
  cameraId: string | null;
  microphoneId: string | null;
  systemAudio: boolean;
};

export const DEFAULT_OPTIONS: SavedOptions = {
  cameraId: null,
  microphoneId: null,
  systemAudio: false,
};

export function parseOptions(saved: string | null): SavedOptions {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(saved ?? "{}") };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export function barLayer(phase: Phase, error: string | null) {
  if (phase !== "idle") return "recording";
  return error ? "error" : "setup";
}

export function elapsedMsAt(
  status: RecordingStatus,
  receivedAt: number,
  now: number,
): number {
  if (status.phase !== "recording") return status.elapsedMs;
  return status.elapsedMs + Math.max(now - receivedAt, 0);
}
