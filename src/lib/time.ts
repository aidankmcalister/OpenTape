export const EASE = [0.32, 0.72, 0, 1] as const;

export function formatTime(ms: number): string {
  const totalHundredths = Math.floor(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}.${twoDigits(hundredths)}`;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${twoDigits(Math.floor(totalSeconds / 60))}:${twoDigits(totalSeconds % 60)}`;
}

export function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

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

type Sighting = { seconds: number; at: number };

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

const waitingSeeks = new WeakMap<HTMLVideoElement, number>();

export function seekTarget(video: HTMLVideoElement): number {
  return waitingSeeks.get(video) ?? video.currentTime;
}

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
