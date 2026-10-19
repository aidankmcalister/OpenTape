import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useOneAtATime, useTauriEvent } from "@/hooks/useTauri";
import { useVideoClock } from "@/hooks/useVideoClock";
import type { PreviewKey } from "@/lib/bindings";
import { IDLE_ACTIVITY, nextActivity, SHOWS_FOR_MS } from "./preview";

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
  // Save, Copy, Edit and Close each export or move the recording, so only one runs at a time,
  // whether it came from a click or a key.
  const oneAtATime = useOneAtATime();
  const videoSrc = videoPath && convertFileSrc(videoPath);
  const clock = useVideoClock(video, isPlaying, videoSrc);

  // A result shows for a moment, then clears.
  useEffect(() => {
    const showsFor = SHOWS_FOR_MS[activity];
    if (showsFor === undefined) return;
    const timeout = setTimeout(() => dispatch({ type: "expire" }), showsFor);
    return () => clearTimeout(timeout);
  }, [activity]);

  // Rust hides the preview between recordings, so its loop would play on out of sight.
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
    // Rust saves to Downloads as an `.mp4`.
    save: () => oneAtATime(() => track("save", "save_recording")),
    copy: () => oneAtATime(() => track("copy", "copy_recording")),
    // Rust hands the recording to the editor, and tells this page it's gone.
    edit: () => oneAtATime(() => invoke("edit_recording")).catch(console.error),
  } satisfies Record<PreviewKey, () => Promise<unknown>>;

  useTauriEvent(
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
    /** Null until a recording finishes, and again once it's closed or moved to the editor. */
    videoSrc,
    /** Null until the video loads. */
    durationMs,
    /** The loop's time. Read it with `useClockValue`, so only the progress bar redraws. */
    clock,
    /** From Rust, because an inactive macOS window gets no mouse moves. Shows the actions. */
    isHovered,
    /** The `data-hover` name of the control under the pointer. */
    hoveredName,
    activity,
    /** Why the last Save or Copy failed. */
    failure,
    /** Spread on the `<video>`, which plays on a loop, so its time and length can be read. */
    videoProps: {
      ref: video,
      onLoadedMetadata: ({ currentTarget }: SyntheticEvent<HTMLVideoElement>) =>
        setDurationMs(currentTarget.duration * 1000),
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
    },
    ...actions,
    // Rust asks to save or delete first, unless it's saved, and tells this page once it's gone.
    // Cancelling the alert keeps it shown.
    close: () =>
      oneAtATime(() => invoke("close_recording")).catch(console.error),
    showInFinder: () => invoke("show_saved_in_finder").catch(console.error),
  };
}
