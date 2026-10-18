import { useRef, useState, type SyntheticEvent } from "react";
import { useVideoClock } from "@/hooks/useVideoClock";
import type { Size } from "@/lib/geometry";
import { showFirstFrame } from "@/lib/video";

/** Plays one video: play and pause, seeking, looping, muting, and how fast it plays. */
export function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const currentMs = useVideoClock(video, isPlaying, src) * 1000;

  function seek(ms: number) {
    const element = video.current;
    if (!element || !durationMs) return;
    element.currentTime = Math.min(Math.max(ms, 0), durationMs) / 1000;
  }

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    if (element.ended) element.currentTime = 0;
    void element.play();
  }

  return {
    currentMs,
    durationMs,
    videoSize,
    isPlaying,
    isLooping,
    isMuted,
    togglePlay,
    seek,
    /** Where the video is right now, even mid-seek, for actions that happen at the playhead. */
    nowMs: () => (video.current?.currentTime ?? 0) * 1000,
    toStart: () => seek(0),
    toEnd: () => seek(durationMs),
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleMute: () => setIsMuted((isOn) => !isOn),
    setRate: (rate: number) => {
      if (video.current) video.current.playbackRate = rate;
    },
    /** Spread on the `<video>`. */
    videoProps: {
      ref: video,
      src,
      loop: isLooping,
      muted: isMuted,
      onLoadedMetadata: ({
        currentTarget,
      }: SyntheticEvent<HTMLVideoElement>) => {
        showFirstFrame(currentTarget);
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

export type Playback = ReturnType<typeof usePlayback>;
