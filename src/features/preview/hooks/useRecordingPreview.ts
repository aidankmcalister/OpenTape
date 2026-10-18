import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useVideoClock } from "@/hooks/useVideoClock";
import { editRecording } from "@/features/editor/lib/editor";
import type { Shown } from "@/lib/bindings/Shown";
import { EVENTS } from "@/lib/events";
import type { Point } from "@/lib/geometry";
import {
  closePreview,
  copyRecording,
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
  /** Null until a recording finishes. */
  videoSrc: string | null;
  /** Null until the video loads. */
  durationMs: number | null;
  /** How far the loop has got, from 0 to 1. */
  progress: number;
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
  const [pointer, setPointer] = useState<Point | null>(null);
  const [activity, setActivity] = useState<Activity>("idle");
  const [failure, setFailure] = useState("");
  const hovered = usePointerHover(pointer);
  const isHovered = pointer !== null;
  const videoSrc = videoPath && convertFileSrc(videoPath);
  const name = videoPath ? exportName(videoPath) : "";
  const seconds = useVideoClock(video, durationMs !== null, videoSrc);

  async function run(
    busy: Activity,
    done: Activity,
    job: () => Promise<unknown>,
  ) {
    if (activity === "saving" || activity === "copying") return;
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
    save: () => run("saving", "saved", () => saveRecording(name)),
    copy: () => run("copying", "copied", () => copyRecording(name)),
    edit: editRecording,
  } satisfies Record<PreviewKey, () => Promise<void>>;

  useTauriEvent<Shown>(
    EVENTS.previewShow,
    ({ videoPath }) => {
      setDurationMs(null);
      setActivity("idle");
      setVideoPath(videoPath);
    },
    "window",
  );
  useTauriEvent<Point | null>(EVENTS.previewPointer, setPointer, "window");
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
    progress: durationMs ? Math.min((seconds * 1000) / durationMs, 1) : 0,
    isHovered,
    hovered,
    activity,
    failure,
    videoProps: {
      ref: video,
      onLoadedMetadata: ({ currentTarget }) =>
        setDurationMs(currentTarget.duration * 1000),
    },
    ...actions,
    close: () => closePreview(name),
    showInFinder: showSavedInFinder,
  };
}
