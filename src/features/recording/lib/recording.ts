import { invoke } from "@tauri-apps/api/core";
import type { RecordingStatus } from "@/lib/bindings/RecordingStatus";
import type { SavedRecording } from "@/lib/bindings/SavedRecording";

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
