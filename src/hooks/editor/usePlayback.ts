import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useClockValue, useVideoClock } from "@/hooks/useVideoClock";
import { amountAt, type Region } from "@/lib/editor/regions";
import { frameStep } from "@/lib/editor/timeline";
import type { Size } from "@/lib/geometry";

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
    ratio,
    videoSize,
    clock,
    togglePlay: () => togglePlay(video.current),
    seek,
    toStart: () => seek(0),
    toEnd: () => seek(durationMs),
    step: (frames: number) => {
      const element = video.current;
      if (!element) return;
      element.pause();
      seek(frameStep(clock.seconds() * 1000, frames, durationMs));
    },
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleSound: () => setIsMuted((isOn) => !isOn),
    setRate: (rate: number) => {
      if (!video.current) return;
      video.current.preservesPitch = false;
      video.current.playbackRate = rate;
    },
    videoProps: {
      ref: video,
      preload: "auto",
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

export function useSpeed(playback: Playback, regions: Region[]) {
  const rate = useClockValue(playback.clock, (seconds) =>
    amountAt(regions, "speed", seconds * 1000),
  );
  useEffect(() => playback.setRate(rate), [playback, rate]);
}

function togglePlay(video: HTMLVideoElement | null) {
  if (!video) return;
  if (video.paused) void video.play();
  else video.pause();
}

function lengthMs(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration * 1000 : 0;
}

function ratioOf(video: HTMLVideoElement): number {
  return video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
}

function sizeOf(video: HTMLVideoElement): Size {
  return { width: video.videoWidth, height: video.videoHeight };
}

function showFirstFrame(event: SyntheticEvent<HTMLVideoElement>) {
  event.currentTarget.currentTime = 0.001;
}
