import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  createClock,
  playingTime,
  seekTarget,
  seekVideo,
  type Clock,
} from "@/lib/time";

type VideoClock = Clock & { seek: (seconds: number) => void };

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
    element.addEventListener("seeking", sync);
    element.addEventListener("seeked", sync);
    const unsync = () => {
      element.removeEventListener("seeking", sync);
      element.removeEventListener("seeked", sync);
    };
    sync();
    if (!isPlaying) return unsync;

    let frame = requestAnimationFrame(function track() {
      clock.set(
        element.seeking
          ? seekTarget(element)
          : playingTime(clock.seconds(), element.currentTime),
      );
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

export function useClockValue<T>(
  clock: Clock,
  select: (seconds: number) => T,
): T {
  const last = useRef<{ value: T; json: string } | null>(null);
  return useSyncExternalStore(clock.subscribe, () => {
    const value = select(clock.seconds());
    const json = JSON.stringify(value);
    if (last.current && last.current.json === json) return last.current.value;
    last.current = { value, json };
    return value;
  });
}
