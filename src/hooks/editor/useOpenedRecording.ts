import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useRustValue } from "@/hooks/useTauri";
import type { ShownRecording } from "@/lib/bindings";

export function useOpenedRecording() {
  const [recording, setRecording] = useState<ShownRecording | null>(null);
  useRustValue("editor_recording", "current-recording", setRecording, "window");

  if (!recording) return null;
  return {
    name: recording.name,
    videoSrc: convertFileSrc(recording.videoPath),
  };
}
