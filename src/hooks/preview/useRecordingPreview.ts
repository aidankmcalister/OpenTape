import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useOneAtATime, useRustValue, useTauriEvent } from "@/hooks/useTauri";
import { useVideoClock } from "@/hooks/useVideoClock";
import type { PreviewKey } from "@/lib/bindings";
import {
  IDLE_ACTIVITY,
  nextActivity,
  SHOWS_FOR_MS,
} from "@/lib/preview/preview";

export function useRecordingPreview() {
  const video = useRef<HTMLVideoElement>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [{ activity, failure }, dispatch] = useReducer(
    nextActivity,
    IDLE_ACTIVITY,
  );
  const { hoveredName, setPointer } = usePointerHover();
  const oneAtATime = useOneAtATime();
  const videoSrc = videoPath && convertFileSrc(videoPath);
  const clock = useVideoClock(video, isPlaying, videoSrc);

  useEffect(() => {
    const showsFor = SHOWS_FOR_MS[activity];
    if (showsFor === undefined) return;
    const timeout = setTimeout(() => dispatch({ type: "expire" }), showsFor);
    return () => clearTimeout(timeout);
  }, [activity]);

  useEffect(() => {
    const followVisibility = () => {
      const element = video.current;
      if (!element) return;
      if (document.hidden) element.pause();
      else element.play().catch(console.error);
    };
    document.addEventListener("visibilitychange", followVisibility);
    return () =>
      document.removeEventListener("visibilitychange", followVisibility);
  }, []);

  function show(path: string | null) {
    setDurationMs(null);
    setIsPlaying(false);
    dispatch({ type: "reset" });
    setVideoPath(path);
  }

  async function track(job: "save" | "copy", command: string) {
    dispatch({ type: "start", job });
    try {
      await invoke(command);
      dispatch({ type: "succeed", job });
    } catch (err) {
      dispatch({ type: "fail", error: String(err) });
    }
  }

  const actions = {
    save: () => oneAtATime(() => track("save", "save_recording")),
    copy: () => oneAtATime(() => track("copy", "copy_recording")),
    edit: () => oneAtATime(() => invoke("edit_recording")).catch(console.error),
  } satisfies Record<PreviewKey, () => Promise<unknown>>;

  useRustValue(
    "shown_recording",
    "current-recording",
    (recording) => show(recording?.videoPath ?? null),
    "window",
  );
  useTauriEvent(
    "preview-pointer",
    (pointer) => {
      setPointer(pointer);
      setIsHovered(pointer !== null);
    },
    "window",
  );
  useTauriEvent("preview-key", (key) => void actions[key](), "window");

  return {
    videoSrc,
    durationMs,
    clock,
    isHovered,
    hoveredName,
    activity,
    failure,
    videoProps: {
      ref: video,
      onLoadedMetadata: ({ currentTarget }: SyntheticEvent<HTMLVideoElement>) =>
        setDurationMs(currentTarget.duration * 1000),
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
    },
    ...actions,
    close: () =>
      oneAtATime(() => invoke("close_recording")).catch(console.error),
    showInFinder: () => invoke("show_saved_in_finder").catch(console.error),
  };
}
