import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import { useVideoClock } from "@/hooks/useVideoClock";
import type { Size } from "@/lib/geometry";

/** Plays one video: play and pause, seeking, looping, muting, and how fast it plays. */
export function usePlayback(src: string) {
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
    element.currentTime = Math.min(Math.max(ms, 0), durationMs) / 1000;
  }

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    if (element.ended) element.currentTime = 0;
    element.play().catch(console.error);
  }

  return {
    /** The playhead, in seconds. Read it with `useClockValue`, so only what shows it redraws. */
    clock,
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

/** WebKit draws nothing until a video plays or seeks, so this seeks away and back to the start. */
function showFirstFrame(video: HTMLVideoElement) {
  video.addEventListener("seeked", () => (video.currentTime = 0), {
    once: true,
  });
  video.currentTime = Math.min(0.1, video.duration / 2);
}
