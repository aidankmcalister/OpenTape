import { invoke } from "@tauri-apps/api/core";

export type Opened = { videoPath: string };

export const editRecording = () => invoke<void>("edit_recording");
export const editorRecording = () => invoke<Opened | null>("editor_recording");
