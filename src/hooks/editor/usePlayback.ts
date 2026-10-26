import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useClockValue, useVideoClock } from "@/hooks/useVideoClock";
import { type Clip, type KeptTime, playOnAt } from "@/lib/editor/clips";
import { amountAt, type Region } from "@/lib/editor/regions";
import type { Size } from "@/lib/geometry";

export function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [heldMs, setHeldMs] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const held = useRef<number | null>(null);
  const clock = useVideoClock(video, isPlaying, src);

  function hold(ms: number | null) {
    held.current = ms;
    setHeldMs(ms);
  }

  function seek(ms: number) {
    hold(null);
    clock.seek(ms / 1000);
  }

  function skim(ms: number | null) {
    if (ms === null) {
      if (held.current !== null) seek(held.current);
    } else if (!isPlaying) {
      if (held.current === null) hold(clock.seconds() * 1000);
      clock.seek(ms / 1000);
    }
  }

  return {
    isPlaying,
    isLooping,
    isMuted,
    durationMs,
    ratio,
    videoSize,
    clock,
    togglePlay: (time: KeptTime) => {
      skim(null);
      const isAtEnd = time.at(clock.seconds() * 1000) >= time.lengthMs;
      if (video.current?.paused && isAtEnd) seek(time.source(0));
      togglePlay(video.current);
    },
    pause: () => video.current?.pause(),
    seek,
    skim,
    heldMs,
    toStart: (time: KeptTime) => seek(time.source(0)),
    toEnd: (time: KeptTime) => seek(time.source(time.lengthMs)),
    step: (frames: number, time: KeptTime) => {
      video.current?.pause();
      seek(time.step(clock.seconds() * 1000, frames));
    },
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleSound: () => setIsMuted((isOn) => !isOn),
    setRate: (rate: number) => {
      if (!video.current) return;
      video.current.preservesPitch = false;
      video.current.playbackRate = rate * speed;
    },
    speed,
    setSpeed,
    leap: (ms: number, time: KeptTime) =>
      seek(time.leap(clock.seconds() * 1000, ms)),
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

export function useCuts(playback: Playback, clips: Clip[]) {
  const { isPlaying, isLooping, durationMs } = playback;
  const playOn = useClockValue(playback.clock, (seconds) =>
    playOnAt(clips, seconds * 1000, durationMs, isLooping && isPlaying),
  );
  useEffect(() => {
    if (!playOn) return;
    if (playOn.isEnd) playback.pause();
    playback.seek(playOn.ms);
  }, [playback, playOn]);
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
  const video = event.currentTarget;
  if (video.currentTime === 0) video.currentTime = 0.001;
}
