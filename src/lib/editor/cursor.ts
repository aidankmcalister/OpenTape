import type { ExportRing, RingStyle } from "@/lib/bindings";
import { MARK_COLORS, type MarkColor } from "./appearance";
import { outputAt, type Region, settingValue, winnerAt } from "./regions";

export type CursorClick = {
  ms: number;
  x: number;
  y: number;
  button: "left" | "right";
};

type Meta = {
  first_frame_time: number;
  screen_rect: { x: number; y: number; width: number; height: number };
  pauses: [number, number][];
};

type Event = {
  type: "move" | "down" | "up";
  t: number;
  x: number;
  y: number;
  button?: "left" | "right";
};

export const RING_MS = 500;

export function readClicks(meta: string, events: string): CursorClick[] {
  const { first_frame_time, screen_rect, pauses }: Meta = JSON.parse(meta);
  const videoMs = (t: number) => {
    const paused = pauses
      .filter(([start]) => start < t)
      .reduce((sum, [start, end]) => sum + Math.min(end, t) - start, 0);
    return (t - first_frame_time - paused) * 1000;
  };
  const isPaused = (t: number) =>
    pauses.some(([start, end]) => t >= start && t < end);
  return events
    .split("\n")
    .filter((line) => line.includes('"down"'))
    .map((line): Event => JSON.parse(line))
    .filter(({ t }) => t >= first_frame_time && !isPaused(t))
    .map(({ t, x, y, button = "left" }) => ({
      ms: videoMs(t),
      x: (x - screen_rect.x) / screen_rect.width,
      y: (y - screen_rect.y) / screen_rect.height,
      button,
    }));
}

export type RingEvent = {
  ms: number;
  x: number;
  y: number;
  color: string;
  size: number;
  style: RingStyle;
};

export function ringEvents(
  clicks: CursorClick[],
  regions: Region[],
): RingEvent[] {
  return clicks.flatMap((click) => {
    const region = winnerAt(regions, "clickRing", click.ms);
    if (!region) return [];
    const value = (key: string) => settingValue(region, key);
    if (click.button === "right" && !value("rightClick")) return [];
    const color = String(value("color"));
    return [
      {
        ms: click.ms,
        x: click.x,
        y: click.y,
        color: MARK_COLORS[color as MarkColor] ?? color,
        size: Number(value("size")),
        style: String(value("style")).toLowerCase() as RingStyle,
      },
    ];
  });
}

export function ringsAt(rings: RingEvent[], ms: number) {
  return rings
    .filter((ring) => ms >= ring.ms && ms < ring.ms + RING_MS)
    .map((ring) => ({
      ...ring,
      circles: ringCircles(ring.style, (ms - ring.ms) / RING_MS, ring.size),
    }));
}

export function ringCircles(style: RingStyle, progress: number, size: number) {
  const ring = (at: number) => ({
    radius: (size / 2) * (0.4 + 0.6 * at),
    alpha: 1 - at,
    isFilled: false,
  });
  if (style === "pulse") {
    return [
      {
        radius: (size / 2) * (0.3 + 0.7 * progress),
        alpha: 0.5 * (1 - progress),
        isFilled: true,
      },
    ];
  }
  if (style === "ripple") {
    return [progress, progress - 0.3].filter((at) => at >= 0).map(ring);
  }
  return [ring(progress)];
}

export function exportRings(
  rings: RingEvent[],
  regions: Region[],
  scale: number,
): ExportRing[] {
  return rings.map(({ ms, x, y, color, size, style }) => ({
    t: outputAt(regions, ms) / 1000,
    x,
    y,
    color,
    size: size * scale,
    style,
  }));
}
