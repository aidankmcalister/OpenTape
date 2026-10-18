import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { editorRecording } from "@/features/editor/lib/editor";
import { recordingName } from "@/features/recording/lib/recording";
import type { Opened } from "@/lib/bindings/Opened";
import { EVENTS } from "@/lib/events";

type OpenedRecording = { videoSrc: string; name: string } | null;

/**
 * The recording handed over by the preview's Edit, or null once the editor closes. Closing is
 * Rust's: it asks first, then deletes an unsaved recording.
 */
export function useOpenedRecording(): OpenedRecording {
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => void editorRecording().then(setOpened), []);
  useTauriEvent<Opened>(EVENTS.editorOpen, setOpened, "window");
  useTauriEvent(EVENTS.editorClosed, () => setOpened(null), "window");

  return (
    opened && {
      videoSrc: convertFileSrc(opened.videoPath),
      name: recordingName(opened.videoPath),
    }
  );
}
