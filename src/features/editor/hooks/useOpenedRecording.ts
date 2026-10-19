import { useEffect, useRef, useState } from "react";
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
  /** Whether an event has arrived, which is newer than what the first ask returns. */
  const hasEvent = useRef(false);

  useEffect(() => {
    let isMounted = true;
    editorRecording()
      .then((answer) => {
        if (isMounted && !hasEvent.current) setOpened(answer);
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);
  const follow = (next: Opened | null) => {
    hasEvent.current = true;
    setOpened(next);
  };
  useTauriEvent<Opened>(EVENTS.editorOpen, follow, "window");
  useTauriEvent(EVENTS.editorClosed, () => follow(null), "window");

  return (
    opened && {
      videoSrc: convertFileSrc(opened.videoPath),
      name: recordingName(opened.videoPath),
    }
  );
}
