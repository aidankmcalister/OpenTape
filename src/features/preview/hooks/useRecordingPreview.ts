import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useClockValue, useVideoClock } from "@/hooks/useVideoClock";
import { editRecording } from "@/features/editor/lib/editor";
import type { Shown } from "@/lib/bindings/Shown";
import type { Clock } from "@/lib/clock";
import { EVENTS } from "@/lib/events";
import type { Point } from "@/lib/geometry";
import {
  closePreview,
  copyRecording,
  isPreviewShown,
  saveRecording,
  showSavedInFinder,
  type PreviewKey,
} from "@/features/preview/lib/preview";
import { exportName } from "@/features/recording/lib/recording";

/** What Save or Copy is doing. Copied, Saved and Failed show briefly, then the actions return. */
type Activity = "idle" | "saving" | "copying" | "copied" | "saved" | "failed";

const SHOWS_FOR_MS: Partial<Record<Activity, number>> = {
  copied: 2000,
  saved: 4000,
  failed: 5000,
};

export type RecordingPreview = {
  /** Null until a recording finishes, and again once it's closed or moved to the editor. */
  videoSrc: string | null;
  /** Null until the video loads. */
  durationMs: number | null;
  /** The loop's time. Read it with `useLoopProgress`, so only the progress bar redraws. */
  clock: Clock;
  /** From Rust, because an inactive macOS window gets no mouse moves. Shows the actions. */
  isHovered: boolean;
  /** The `data-hover` name of the control under the pointer. */
  hovered: string | null;
  activity: Activity;
  /** Why the last Save or Copy failed. */
  failure: string;
  /** Spread on the `<video>`, which plays on a loop, so its time and length can be read. */
  videoProps: {
    ref: RefObject<HTMLVideoElement | null>;
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
    onPlay: () => void;
    onPause: () => void;
  };
  save: () => Promise<void>;
  copy: () => Promise<void>;
  edit: () => Promise<void>;
  /** Rust asks to save or delete first, unless it's saved. */
  close: () => Promise<void>;
  showInFinder: () => Promise<void>;
};

export function useRecordingPreview(): RecordingPreview {
  const video = useRef<HTMLVideoElement>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [activity, setActivity] = useState<Activity>("idle");
  const [failure, setFailure] = useState("");
  const { hovered, point } = usePointerHover();
  // Save, Copy, Edit and Close each export or move the recording, so only one runs at a time,
  // whether it came from a click or a key.
  const oneAtATime = useOneAtATime();
  const videoSrc = videoPath && convertFileSrc(videoPath);
  const name = videoPath ? exportName(videoPath) : "";
  const clock = useVideoClock(video, isPlaying, videoSrc);
  usePauseWhileHidden(video);

  function show(path: string | null) {
    setDurationMs(null);
    setIsPlaying(false);
    setActivity("idle");
    setVideoPath(path);
  }

  async function run(
    busy: Activity,
    done: Activity,
    job: () => Promise<unknown>,
  ) {
    setActivity(busy);
    try {
      await job();
      setActivity(done);
    } catch (err) {
      setFailure(String(err));
      setActivity("failed");
    }
  }

  const actions = {
    save: () =>
      oneAtATime(() => run("saving", "saved", () => saveRecording(name))),
    copy: () =>
      oneAtATime(() => run("copying", "copied", () => copyRecording(name))),
    // The editor takes the recording, so the hidden preview lets go of it.
    edit: () =>
      oneAtATime(async () => {
        await editRecording();
        show(null);
      }).catch(console.error),
  } satisfies Record<PreviewKey, () => Promise<void>>;

  async function close() {
    await closePreview(name).catch(console.error);
    if (!(await isPreviewShown())) show(null);
  }

  useTauriEvent<Shown>(
    EVENTS.previewShow,
    ({ videoPath }) => show(videoPath),
    "window",
  );
  useTauriEvent<Point | null>(
    EVENTS.previewPointer,
    (pointer) => {
      point(pointer);
      setIsHovered(pointer !== null);
    },
    "window",
  );
  useTauriEvent<PreviewKey>(
    EVENTS.previewKey,
    (key) => void actions[key](),
    "window",
  );

  useEffect(() => {
    const showsFor = SHOWS_FOR_MS[activity];
    if (showsFor === undefined) return;
    const timer = setTimeout(() => setActivity("idle"), showsFor);
    return () => clearTimeout(timer);
  }, [activity]);

  return {
    videoSrc,
    durationMs,
    clock,
    isHovered,
    hovered,
    activity,
    failure,
    videoProps: {
      ref: video,
      onLoadedMetadata: ({ currentTarget }) =>
        setDurationMs(currentTarget.duration * 1000),
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
    },
    ...actions,
    close: () => oneAtATime(close).catch(console.error),
    showInFinder: () => showSavedInFinder().catch(console.error),
  };
}

/** How far the loop has got, from 0 to 1. Redraws only the caller as the clip plays. */
export function useLoopProgress({
  clock,
  durationMs,
}: Pick<RecordingPreview, "clock" | "durationMs">): number {
  return useClockValue(clock, (seconds) =>
    durationMs ? Math.min((seconds * 1000) / durationMs, 1) : 0,
  );
}

/**
 * The preview is hidden, never closed, so its loop would play on out of sight. It pauses while
 * the page is hidden and plays again when it's shown.
 */
function usePauseWhileHidden(video: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const follow = () => {
      const element = video.current;
      if (!element) return;
      if (document.hidden) element.pause();
      else element.play().catch(console.error);
    };
    document.addEventListener("visibilitychange", follow);
    return () => document.removeEventListener("visibilitychange", follow);
  }, [video]);
}
