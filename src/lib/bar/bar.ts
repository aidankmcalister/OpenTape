import type { KeptRecording, Phase, RecordingStatus } from "@/lib/bindings";

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

export function recentLabel(recording: KeptRecording, now: Date): string {
  const at = new Date(recording.modifiedMs);
  const time = at
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, " ");
  return [
    ...(recording.isRecovered ? ["Recovered"] : []),
    `${dayLabel(at, now)}, ${time}`,
    sizeLabel(recording.sizeBytes),
    ...(recording.isEdited ? ["Edited"] : []),
  ].join(" · ");
}

export function recentSummary(recordings: KeptRecording[]): string {
  const bytes = recordings.reduce((sum, { sizeBytes }) => sum + sizeBytes, 0);
  const count = recordings.length;
  return `${count} ${count === 1 ? "recording" : "recordings"} · ${sizeLabel(bytes)}`;
}

function dayLabel(at: Date, now: Date): string {
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sizeLabel(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  return megabytes >= 1000
    ? `${(megabytes / 1000).toFixed(1)} GB`
    : `${Math.max(1, Math.round(megabytes))} MB`;
}
