export const EASE = [0.32, 0.72, 0, 1] as const;

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
