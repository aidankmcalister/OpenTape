import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFinishedRecording } from "@/hooks/editor/useProject";
import { useTimeMap } from "@/hooks/editor/usePlayback";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useOneAtATime, useTauriEvent } from "@/hooks/useTauri";
import type { PreviewKey } from "@/lib/bindings";
import { frameShape } from "@/lib/editor/appearance";
import { dockLayer } from "@/lib/preview/preview";

export function useRecordingPreview(videoSrc: string) {
  const recording = useFinishedRecording(videoSrc, 0, true);
  const { playback, edits, exporting, isLoaded, isReady } = recording;
  const { play, pause } = playback;
  useTimeMap(playback, edits.time);
  const [isHovered, setIsHovered] = useState(false);
  const [isShaped, setIsShaped] = useState(false);
  const { hoveredName, setPointer } = usePointerHover();
  const oneAtATime = useOneAtATime();
  const isBusy = exporting.state.stage === "exporting";
  const shape =
    isLoaded && playback.videoSize
      ? frameShape(edits.project.appearance, playback.ratio)
      : null;

  useEffect(() => {
    if (shape === null) return;
    void invoke("shape_preview", { ratio: shape })
      .catch(console.error)
      .finally(() => setIsShaped(true));
  }, [shape]);

  useEffect(() => {
    if (!isReady) return;
    const followVisibility = () => (document.hidden ? pause() : play());
    followVisibility();
    document.addEventListener("visibilitychange", followVisibility);
    return () =>
      document.removeEventListener("visibilitychange", followVisibility);
  }, [isReady, play, pause]);

  const whenIdle = (command: string) => () => {
    if (!isBusy) oneAtATime(() => invoke(command)).catch(console.error);
  };
  const actions = {
    save: () =>
      exporting.showSaved ? exporting.showSaved() : exporting.start?.("file"),
    copy: () => exporting.start?.("clipboard"),
    edit: whenIdle("edit_recording"),
  } satisfies Record<PreviewKey, () => void>;

  useTauriEvent(
    "preview-pointer",
    (pointer) => {
      setPointer(pointer);
      setIsHovered(pointer !== null);
    },
    "window",
  );
  useTauriEvent("preview-key", (key) => actions[key](), "window");

  return {
    ...recording,
    isShown: isShaped,
    isHovered,
    hoveredName,
    layer: dockLayer(exporting.state),
    ...actions,
    close: whenIdle("close_recording"),
  };
}
