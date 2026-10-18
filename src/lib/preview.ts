import { invoke } from "@tauri-apps/api/core";

export type Shown = { videoPath: string };

/** E, ⌘C and ⌘S, which Rust takes while the pointer is over the preview. */
export type PreviewKey = "edit" | "copy" | "save";

/** Saves to Downloads as an `.mp4` and returns where. */
export const saveRecording = (name: string) =>
  invoke<string>("save_recording", { name });
export const copyRecording = (name: string) =>
  invoke<void>("copy_recording", { name });
/** Closes the preview. Rust asks to save or delete first, unless it's saved. */
export const closePreview = (name: string) =>
  invoke<void>("close_preview", { name });
export const showSavedInFinder = () => invoke<void>("show_saved_in_finder");
