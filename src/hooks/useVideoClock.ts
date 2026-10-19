import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createClock, estimateTime, type Clock } from "@/lib/time";

/**
 * The video's time, smooth enough to drive a playhead, kept outside React state so the frames
 * redraw only what reads it, through `useClockValue`. `src` restarts it when the video changes.
 */
export function useVideoClock(
  video: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  src: string | null,
): Clock {
  const [clock] = useState(createClock);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => clock.set(element.currentTime);
    element.addEventListener("seeked", sync);
    sync();
    if (!isPlaying) return () => element.removeEventListener("seeked", sync);

    let sighting = { seconds: element.currentTime, at: performance.now() };
    let frame = requestAnimationFrame(function track(now) {
      const estimate = estimateTime(sighting, now, element);
      sighting = estimate.sighting;
      clock.set(estimate.seconds);
      frame = requestAnimationFrame(track);
    });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("seeked", sync);
    };
  }, [clock, video, isPlaying, src]);

  return clock;
}

/** `select` of the clock's seconds, redrawing the caller only when that result changes. */
export function useClockValue<T>(
  clock: Clock,
  select: (seconds: number) => T,
): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.seconds()));
}
