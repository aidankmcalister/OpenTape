import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  createClock,
  estimateTime,
  seekTarget,
  seekVideo,
  type Clock,
} from "@/lib/time";

/** A video's clock, plus `seek` to move the video. */
export type VideoClock = Clock & { seek: (seconds: number) => void };

/**
 * The video's time, smooth enough to drive a playhead. It's kept outside React state, so only what
 * reads it through `useClockValue` redraws as it moves. `src` restarts it when the video changes.
 *
 * `seek` is the one way to move the video. The playhead and readout jump at once, and the picture
 * follows as fast as the video decodes; `seekVideo` coalesces rapid seeks.
 */
export function useVideoClock(
  video: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  src: string | null,
): VideoClock {
  const [clock] = useState(createClock);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => clock.set(seekTarget(element));
    // "seeking" moves the playhead the moment a seek starts; "seeked" settles it where it landed.
    element.addEventListener("seeking", sync);
    element.addEventListener("seeked", sync);
    const unsync = () => {
      element.removeEventListener("seeking", sync);
      element.removeEventListener("seeked", sync);
    };
    sync();
    if (!isPlaying) return unsync;

    let sighting = { seconds: element.currentTime, at: performance.now() };
    let frame = requestAnimationFrame(function track(now) {
      const estimate = estimateTime(sighting, now, element);
      sighting = estimate.sighting;
      // While a seek is running the video isn't moving, so the playhead stays where it was sent.
      clock.set(element.seeking ? seekTarget(element) : estimate.seconds);
      frame = requestAnimationFrame(track);
    });
    return () => {
      cancelAnimationFrame(frame);
      unsync();
    };
  }, [clock, video, isPlaying, src]);

  const [videoClock] = useState<VideoClock>(() => ({
    seconds: clock.seconds,
    subscribe: clock.subscribe,
    seek: (seconds) => {
      if (!video.current) return;
      clock.set(seconds);
      seekVideo(video.current, seconds);
    },
  }));
  return videoClock;
}

/** `select` of the clock's seconds, redrawing the caller only when that result changes. */
export function useClockValue<T>(
  clock: Clock,
  select: (seconds: number) => T,
): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.seconds()));
}
