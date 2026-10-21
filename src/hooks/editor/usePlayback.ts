import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useVideoClock } from "@/hooks/useVideoClock";

/** Plays, pauses and seeks one video, and keeps its time. Space plays and pauses. */
export function usePlayback(src: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const clock = useVideoClock(video, isPlaying, src);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Holding Space repeats the key, which would flicker between play and pause.
      if (event.key !== " " || event.repeat) return;
      // Otherwise a focused button would also get the Space and toggle it straight back.
      event.preventDefault();
      togglePlay(video.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    isPlaying,
    durationMs,
    /** The playhead's time, smooth while playing. Read it with `useClockValue`. */
    clock,
    togglePlay: () => togglePlay(video.current),
    seek: (ms: number) => {
      if (video.current) video.current.currentTime = ms / 1000;
    },
    /** Spread onto the `<video>`. */
    videoProps: {
      ref: video,
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
        setDurationMs(lengthMs(event.currentTarget));
        showFirstFrame(event);
      },
    },
  };
}

function togglePlay(video: HTMLVideoElement | null) {
  if (!video) return;
  if (video.paused) void video.play();
  else video.pause();
}

/** The video's length, or 0 while it isn't known. */
function lengthMs(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration * 1000 : 0;
}

/** WebKit draws nothing until the video moves, so a tiny step shows its first frame. */
function showFirstFrame(event: SyntheticEvent<HTMLVideoElement>) {
  event.currentTarget.currentTime = 0.001;
}
