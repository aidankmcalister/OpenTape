import { useEffect, useState, type RefObject } from "react";

/**
 * The video's time in seconds, smooth enough to drive a playhead. WebKit updates `currentTime`
 * only a few times a second, so while playing, the frames between are estimated from the clock.
 * `src` restarts the clock when the video changes.
 */
export function useVideoClock(
  video: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  src: string | null,
): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => setSeconds(element.currentTime);
    element.addEventListener("seeked", sync);
    sync();
    if (!isPlaying) return () => element.removeEventListener("seeked", sync);

    let known = { seconds: element.currentTime, at: performance.now() };
    let frame = requestAnimationFrame(function track(now) {
      if (element.currentTime !== known.seconds) {
        known = { seconds: element.currentTime, at: now };
      }
      const elapsed = ((now - known.at) / 1000) * element.playbackRate;
      const estimate = element.paused ? known.seconds : known.seconds + elapsed;
      setSeconds(Math.min(estimate, element.duration || estimate));
      frame = requestAnimationFrame(track);
    });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("seeked", sync);
    };
  }, [video, isPlaying, src]);

  return seconds;
}
