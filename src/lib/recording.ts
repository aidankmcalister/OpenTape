import { invoke } from "@tauri-apps/api/core";

/** What to record. Matches the Rust `Target` enum. */
export type Target =
  | { kind: "display"; displayId: number }
  | { kind: "window"; windowId: number }
  | {
      kind: "area";
      displayId: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export type Phase = "idle" | "starting" | "recording" | "paused" | "stopping";

/** Rust's recording status, the only copy of it. Matches the Rust `Status`. */
export type RecordingStatus = {
  phase: Phase;
  error: string | null;
  /** Time recorded when the status was sent, not counting pauses. */
  elapsedMs: number;
};

type SavedRecording = { videoPath: string };

export const recordingStatus = () =>
  invoke<RecordingStatus>("recording_status");
export const pauseRecording = (paused: boolean) =>
  invoke<void>("pause_recording", { paused });
export const restartRecording = () => invoke<void>("restart_recording");
export const stopRecording = () => invoke<SavedRecording>("stop_recording");

const FOLDER_TIME = /recording-(\d+)/;

/** "2026-10-16 07.41.28", from the time in the recording's folder name. */
export function recordingName(videoPath: string): string {
  const seconds = FOLDER_TIME.exec(videoPath)?.[1];
  if (!seconds) return "Untitled recording";
  const date = new Date(Number(seconds) * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `${day} ${time}`;
}

/** What a saved or copied recording is called, the way macOS names its own screen recordings. */
export function exportName(videoPath: string): string {
  return `Screen Recording ${recordingName(videoPath).replace(" ", " at ")}`;
}
