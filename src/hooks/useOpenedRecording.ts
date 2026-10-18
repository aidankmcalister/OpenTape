import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { editorRecording, type Opened } from "@/lib/editor";
import { recordingName } from "@/lib/recording";

export type OpenedRecording = { videoSrc: string; name: string } | null;

/**
 * The recording handed over by the preview's Edit, or null once the editor closes. Closing is
 * Rust's: it asks first, then deletes an unsaved recording.
 */
export function useOpenedRecording(): OpenedRecording {
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => {
    void editorRecording().then(setOpened);
    const window = getCurrentWebviewWindow();
    const stopOpen = window.listen<Opened>("editor-open", ({ payload }) =>
      setOpened(payload),
    );
    const stopClose = window.listen("editor-closed", () => setOpened(null));
    return () => {
      void stopOpen.then((stop) => stop());
      void stopClose.then((stop) => stop());
    };
  }, []);

  return (
    opened && {
      videoSrc: convertFileSrc(opened.videoPath),
      name: recordingName(opened.videoPath),
    }
  );
}
