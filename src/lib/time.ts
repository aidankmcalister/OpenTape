/** "mm:ss.hh", for the editor's playhead. */
export function formatTime(ms: number): string {
  const totalHundredths = Math.floor(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}.${twoDigits(hundredths)}`;
}

/** "mm:ss", for a running recording. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${twoDigits(Math.floor(totalSeconds / 60))}:${twoDigits(totalSeconds % 60)}`;
}

export function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A time in seconds that changes every frame, held outside React. Only the parts that show it
 * subscribe, so a playing video redraws only its playhead and readout.
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
type Sighting = { seconds: number; at: number };

/**
 * A playing video's time at `now`. WebKit moves `currentTime` only a few times a second, so this
 * counts on from the last time it moved.
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
