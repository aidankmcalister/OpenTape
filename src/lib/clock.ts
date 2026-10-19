/**
 * A time in seconds that changes every frame, held outside React. Only the parts that show it
 * subscribe, so a playing video redraws its playhead and readout, not the whole page.
 */
export type Clock = {
  seconds: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createClock(): Clock & { set: (seconds: number) => void } {
  let current = 0;
  const listeners = new Set<() => void>();
  return {
    seconds: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (seconds) => {
      if (seconds === current) return;
      current = seconds;
      for (const listener of listeners) listener();
    },
  };
}

/** Where a video was last seen to be, and when, by `performance.now()`. */
export type Sighting = { seconds: number; at: number };

/**
 * A playing video's time at `now`. WebKit moves `currentTime` only a few times a second, so the
 * frames between are counted on from the last time it moved.
 */
export function estimateTime(
  last: Sighting,
  now: number,
  video: Pick<
    HTMLVideoElement,
    "currentTime" | "playbackRate" | "paused" | "duration"
  >,
): { sighting: Sighting; seconds: number } {
  const sighting =
    video.currentTime === last.seconds
      ? last
      : { seconds: video.currentTime, at: now };
  const elapsed = ((now - sighting.at) / 1000) * video.playbackRate;
  const estimate = video.paused ? sighting.seconds : sighting.seconds + elapsed;
  return { sighting, seconds: Math.min(estimate, video.duration || estimate) };
}
