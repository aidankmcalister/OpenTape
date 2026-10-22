import { useRef, useState, type SyntheticEvent } from "react";
import { useVideoClock } from "@/hooks/useVideoClock";
import { frameStep } from "@/lib/editor/timeline";
import type { Size } from "@/lib/geometry";

/** Controls one video's playback and keeps its time. The keymap drives its keys. */
export function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const clock = useVideoClock(video, isPlaying, src);

  function seek(ms: number) {
    clock.seek(ms / 1000);
  }

  return {
    isPlaying,
    isLooping,
    isMuted,
    durationMs,
    /** The video's width over its height. */
    ratio,
    /** The video's size in pixels, or null until it loads. */
    videoSize,
    /** The playhead's time, smooth while playing. Read it with `useClockValue`. */
    clock,
    togglePlay: () => togglePlay(video.current),
    seek,
    toStart: () => seek(0),
    toEnd: () => seek(durationMs),
    /** Pauses, then moves `frames` frames on: 1 is forward, -1 is back. */
    step: (frames: number) => {
      const element = video.current;
      if (!element) return;
      element.pause();
      seek(frameStep(clock.seconds() * 1000, frames, durationMs));
    },
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleSound: () => setIsMuted((isOn) => !isOn),
    /** Spread onto the `<video>`. */
    videoProps: {
      ref: video,
      loop: isLooping,
      muted: isMuted,
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
        setDurationMs(lengthMs(event.currentTarget));
        setRatio(ratioOf(event.currentTarget));
        setVideoSize(sizeOf(event.currentTarget));
        showFirstFrame(event);
      },
    },
  };
}

export type Playback = ReturnType<typeof usePlayback>;

function togglePlay(video: HTMLVideoElement | null) {
  if (!video) return;
  if (video.paused) void video.play();
  else video.pause();
}

/** The video's length, or 0 while it isn't known. */
function lengthMs(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration * 1000 : 0;
}

/** The video's width over its height, or 16:9 while it isn't known. */
function ratioOf(video: HTMLVideoElement): number {
  return video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
}

/** The video's size in pixels. */
function sizeOf(video: HTMLVideoElement): Size {
  return { width: video.videoWidth, height: video.videoHeight };
}

/** WebKit draws nothing until the video moves, so a tiny step shows its first frame. */
function showFirstFrame(event: SyntheticEvent<HTMLVideoElement>) {
  event.currentTarget.currentTime = 0.001;
}
