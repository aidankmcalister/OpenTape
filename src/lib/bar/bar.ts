import type { Access, Phase, RecordingStatus } from "@/lib/bindings";
import type { News } from "@/lib/update";

const UPDATE_LAYERS = {
  available: "updateAvailable",
  downloading: "updateDownloading",
  ready: "updateReady",
  failed: "updateFailed",
} as const;

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

export function barLayer({
  phase,
  isCountingDown,
  screenRecording,
  error,
  update,
}: {
  phase: Phase;
  isCountingDown: boolean;
  screenRecording: Access | undefined;
  error: string | null;
  update: News | null;
}) {
  if (isCountingDown) return "countdown";
  if (phase !== "idle") return "recording";
  if (screenRecording === "needsRestart") return "restart";
  if (screenRecording === "notAsked" || screenRecording === "off")
    return "permission";
  if (error) return "error";
  return update ? UPDATE_LAYERS[update] : "setup";
}

export function elapsedMsAt(
  status: RecordingStatus,
  receivedAt: number,
  now: number,
): number {
  if (status.phase !== "recording") return status.elapsedMs;
  return status.elapsedMs + Math.max(now - receivedAt, 0);
}
