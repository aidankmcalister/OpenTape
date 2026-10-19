import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useRustValue } from "@/hooks/useTauri";
import { useClockValue, useVideoClock } from "@/hooks/useVideoClock";
import type { ShownRecording } from "@/lib/bindings";
import { clamp, type Size } from "@/lib/geometry";
import {
  addRegion,
  amountAt,
  clampAmount,
  DEFAULT_LOOK,
  regionKindForKey,
  type Amount,
  type Fill,
  type Look,
  type Region,
  type RegionKind,
} from "./edits";

/** The recording handed over by the preview's Edit, or null once the editor closes. */
export function useOpenedRecording() {
  const [opened, setOpened] = useState<ShownRecording | null>(null);
  useRustValue("editor_recording", "current-recording", setOpened, "window");

  return (
    opened && {
      videoSrc: convertFileSrc(opened.videoPath),
      name: opened.name,
    }
  );
}

/**
 * The state the editor's panels share. Speed at the playhead redraws the editor only when the
 * playhead crosses a speed region's edge. It plays through the video's rate, from the same regions
 * `outputAt` and `sourceAt` map export's time with.
 */
export function useEditor(videoSrc: string) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const playback = usePlayback(videoSrc);
  const { clock, durationMs, nowMs, setRate } = playback;

  const rate = useClockValue(clock, (seconds) =>
    amountAt(regions, "speed", seconds * 1000),
  );
  useEffect(() => setRate(rate), [rate, setRate]);

  function add(kind: RegionKind) {
    setRegions((current) => addRegion(current, kind, nowMs(), durationMs));
  }

  // Space plays and pauses, Z and S add a region at the playhead, Delete removes the selected one.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.target instanceof HTMLInputElement
      ) {
        return;
      }
      const kind = regionKindForKey(event.key);
      if (event.key === " ") playback.togglePlay();
      else if (kind) add(kind);
      else if (event.key === "Delete" || event.key === "Backspace") {
        setRegions((current) => current.filter(({ id }) => id !== selectedId));
        setSelectedId(null);
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return {
    playback,
    rate,
    regions,
    selectedId,
    select: setSelectedId,
    add,
    look,
    setFill: (fill: Fill) => setLook((current) => ({ ...current, fill })),
    setAmount: (amount: Amount, value: number) =>
      setLook((current) => ({
        ...current,
        [amount]: clampAmount(amount, value),
      })),
    resetLook: () => setLook(DEFAULT_LOOK),
  };
}

export type Editor = ReturnType<typeof useEditor>;

function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const clock = useVideoClock(video, isPlaying, src);
  const setRate = useCallback((rate: number) => {
    if (video.current) video.current.playbackRate = rate;
  }, []);

  function seek(ms: number) {
    const element = video.current;
    if (!element || !durationMs) return;
    element.currentTime = clamp(ms, 0, durationMs) / 1000;
  }

  return {
    /** The playhead, in seconds. Read it with `useClockValue`, so only what shows it redraws. */
    clock,
    durationMs,
    videoSize,
    isPlaying,
    isLooping,
    isMuted,
    togglePlay: () => {
      const element = video.current;
      if (!element) return;
      if (!element.paused) return element.pause();
      if (element.ended) element.currentTime = 0;
      element.play().catch(console.error);
    },
    seek,
    /** Where the video is right now, even mid-seek, for actions that happen at the playhead. */
    nowMs: () => (video.current?.currentTime ?? 0) * 1000,
    toStart: () => seek(0),
    toEnd: () => seek(durationMs),
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleMute: () => setIsMuted((isOn) => !isOn),
    setRate,
    /** Spread on the `<video>`. */
    videoProps: {
      ref: video,
      src,
      loop: isLooping,
      muted: isMuted,
      onLoadedMetadata: ({
        currentTarget,
      }: SyntheticEvent<HTMLVideoElement>) => {
        // WebKit draws nothing until a video plays or seeks, so this seeks away and back.
        currentTarget.addEventListener(
          "seeked",
          () => (currentTarget.currentTime = 0),
          { once: true },
        );
        currentTarget.currentTime = Math.min(0.1, currentTarget.duration / 2);
        setDurationMs(currentTarget.duration * 1000);
        setVideoSize({
          width: currentTarget.videoWidth,
          height: currentTarget.videoHeight,
        });
      },
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => setIsPlaying(false),
    },
  };
}

/** An element's size, kept current as it resizes. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((size) =>
        size.width === width && size.height === height
          ? size
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
