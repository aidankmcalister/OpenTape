import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useRustValue } from "@/hooks/useTauri";
import type { ShownRecording } from "@/lib/bindings";

/** The recording the preview's Edit handed over, or null while there's none. */
export function useOpenedRecording() {
  const [recording, setRecording] = useState<ShownRecording | null>(null);
  useRustValue("editor_recording", "current-recording", setRecording, "window");

  if (!recording) return null;
  return {
    name: recording.name,
    // The page can't read files by path; this turns the path into a URL it can play.
    videoSrc: convertFileSrc(recording.videoPath),
  };
}
