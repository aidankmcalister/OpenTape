import { invoke } from "@tauri-apps/api/core";
import type { Opened } from "@/lib/bindings/Opened";

export const editRecording = () => invoke<void>("edit_recording");
export const editorRecording = () => invoke<Opened | null>("editor_recording");
