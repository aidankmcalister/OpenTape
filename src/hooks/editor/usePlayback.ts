import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useClockValue, useVideoClock } from "@/hooks/useVideoClock";
import type { SoundTrack } from "@/lib/bindings";
import type { TimeMap } from "@/lib/editor/clips";
import { type SoundSettings, stageSound } from "@/lib/editor/sound";
import type { Size } from "@/lib/geometry";

export function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
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
    } else if (video.current?.paused) {
      if (held.current === null) hold(clock.seconds() * 1000);
      clock.seek(ms / 1000);
    }
  }

  return {
    isPlaying,
    isLooping,
    isMuted,
    durationMs,
    ratio: videoSize?.height ? videoSize.width / videoSize.height : 16 / 9,
    videoSize,
    clock,
    pause: () => video.current?.pause(),
    seek,
    skim,
    heldMs,
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleSound: () => setIsMuted((isOn) => !isOn),
    setRate: (rate: number) => {
      if (!video.current) return;
      video.current.preservesPitch = false;
      video.current.playbackRate = rate * speed;
    },
    speed,
    setSpeed,
    videoProps: {
      ref: video,
      preload: "auto",
      loop: isLooping,
      muted: isMuted,
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => setIsPlaying(false),
      onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
        setDurationMs(lengthMs(event.currentTarget));
        setVideoSize(sizeOf(event.currentTarget));
        showFirstFrame(event);
      },
    },
  };
}

export type Playback = ReturnType<typeof usePlayback>;

export function useTimeMap(playback: Playback, time: TimeMap) {
  const { isPlaying, isLooping, clock, seek, pause } = playback;
  const video = playback.videoProps.ref;
  const rate = useClockValue(clock, (seconds) => time.speedAt(seconds * 1000));
  const playOn = useClockValue(clock, (seconds) =>
    time.playOn(seconds * 1000, isLooping && isPlaying),
  );
  useEffect(() => playback.setRate(rate), [playback, rate]);
  useEffect(() => {
    if (!playOn || playback.heldMs !== null) return;
    if (playOn.isEnd) playback.pause();
    playback.seek(playOn.ms);
  }, [playback, playOn]);
  return {
    togglePlay: () => {
      playback.skim(null);
      const current = video.current;
      if (!current?.paused) return current?.pause();
      if (time.at(clock.seconds() * 1000) >= time.lengthMs)
        seek(time.source(0));
      void current.play();
    },
    toStart: () => seek(time.source(0)),
    toEnd: () => seek(time.source(time.lengthMs)),
    step: (frames: number) => {
      pause();
      seek(time.step(clock.seconds() * 1000, frames));
    },
    leap: (ms: number) => seek(time.leap(clock.seconds() * 1000, ms)),
  };
}

export function useStageSound(
  playback: Playback,
  sound: SoundSettings,
  tracks: SoundTrack[] | null,
) {
  const { ref } = playback.videoProps;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const { volume, enabled } = stageSound(sound, tracks ?? []);
    video.volume = volume;
    const { audioTracks } = video as {
      audioTracks?: ArrayLike<{ enabled: boolean }>;
    };
    Array.from(audioTracks ?? []).forEach((track, index) => {
      track.enabled = enabled[index] ?? true;
    });
  }, [ref, sound, tracks, playback.durationMs]);
}

function lengthMs(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration * 1000 : 0;
}

function sizeOf(video: HTMLVideoElement): Size {
  return { width: video.videoWidth, height: video.videoHeight };
}

function showFirstFrame(event: SyntheticEvent<HTMLVideoElement>) {
  const video = event.currentTarget;
  if (video.currentTime === 0) video.currentTime = 0.001;
}
