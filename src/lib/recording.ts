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

export type SavedRecording = {
  folder: string;
  videoPath: string;
  frames: number;
};

export const startRecording = (target: Target) =>
  invoke<void>("start_recording", { target });
export const stopRecording = () => invoke<SavedRecording>("stop_recording");
