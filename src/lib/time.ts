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
 * counts on from the last time it moved. A paused or seeking video isn't moving, so the count
 * starts again from when it plays on; otherwise a seek while playing runs ahead, then snaps back.
 */
export function estimateTime(
  last: Sighting,
  now: number,
  video: Pick<
    HTMLVideoElement,
    "currentTime" | "playbackRate" | "paused" | "seeking" | "duration"
  >,
): { sighting: Sighting; seconds: number } {
  const isStill = video.paused || video.seeking;
  const sighting =
    !isStill && video.currentTime === last.seconds
      ? last
      : { seconds: video.currentTime, at: now };
  const elapsed = ((now - sighting.at) / 1000) * video.playbackRate;
  const estimate = sighting.seconds + elapsed;
  return { sighting, seconds: Math.min(estimate, video.duration || estimate) };
}

/** For each video, the seek waiting for the running one to land. */
const waitingSeeks = new WeakMap<HTMLVideoElement, number>();

/** Where a video is headed, in seconds: the seek waiting to start, or else its current time. */
export function seekTarget(video: HTMLVideoElement): number {
  return waitingSeeks.get(video) ?? video.currentTime;
}

/**
 * Seeks a video without letting seeks pile up. While one is running, only the latest target
 * waits, and it starts the moment the running one lands. A slow seek, to a frame far from a
 * keyframe, can't stack up clicks or held keys that then play out one by one.
 */
export function seekVideo(video: HTMLVideoElement, seconds: number) {
  if (!video.seeking) {
    video.currentTime = seconds;
    return;
  }
  if (!waitingSeeks.has(video)) {
    video.addEventListener(
      "seeked",
      () => {
        const next = waitingSeeks.get(video);
        waitingSeeks.delete(video);
        if (next !== undefined) seekVideo(video, next);
      },
      { once: true },
    );
  }
  waitingSeeks.set(video, seconds);
}
