import { clamp, fitInside, type Point, type Size } from "@/lib/geometry";
import { twoDigits } from "@/lib/time";

export type Fill = { kind: "gradient" | "color" | "image"; preset: number };

export type Look = {
  fill: Fill;
  padding: number;
  radius: number;
  inset: number;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetY: number;
  borderWidth: number;
};

export type Amount = Exclude<keyof Look, "fill">;

export const GRADIENTS: [string, string, string][] = [
  ["#0f4c5c", "#2a9d8f", "#e9c46a"],
  ["#ff9a4d", "#e8680a", "#7a2e0b"],
  ["#1e3a8a", "#3b82f6", "#bfdbfe"],
  ["#27272a", "#52525b", "#a1a1aa"],
  ["#14532d", "#16a34a", "#bbf7d0"],
  ["#7f1d1d", "#dc2626", "#fca5a5"],
  ["#e7e5e4", "#d6d3d1", "#a8a29e"],
  ["#0a0a0b", "#18181b", "#3f3f46"],
];

/** The middle stop of each gradient, so Color offers the same family. */
export const COLORS = GRADIENTS.map(([, middle]) => middle);

export const AMOUNTS: Record<
  Amount,
  { label: string; max: number; unit: "px" | "%" }
> = {
  padding: { label: "Padding", max: 160, unit: "px" },
  radius: { label: "Rounded corners", max: 40, unit: "px" },
  inset: { label: "Inset", max: 40, unit: "px" },
  shadowOpacity: { label: "Opacity", max: 100, unit: "%" },
  shadowBlur: { label: "Blur", max: 100, unit: "px" },
  shadowOffsetY: { label: "Offset Y", max: 64, unit: "px" },
  borderWidth: { label: "Width", max: 8, unit: "px" },
};

export const DEFAULT_LOOK: Look = {
  fill: { kind: "gradient", preset: 0 },
  padding: 64,
  radius: 20,
  inset: 0,
  shadowOpacity: 40,
  shadowBlur: 48,
  shadowOffsetY: 16,
  borderWidth: 0,
};

export function fillCss(fill: Fill): string {
  if (fill.kind === "color") return COLORS[fill.preset];
  const [from, middle, to] = GRADIENTS[fill.preset];
  return `linear-gradient(135deg, ${from} 0%, ${middle} 55%, ${to} 100%)`;
}

export function clampAmount(amount: Amount, value: number): number {
  return Math.round(clamp(value, 0, AMOUNTS[amount].max));
}

/**
 * How the look frames the recording on a canvas. The frame fits inside the canvas, leaving 48pt
 * around it, and the recording fits inside the frame, leaving the look's padding. `scale` turns
 * look sizes into canvas points: a look is measured on a frame 1920 wide, so it matches at any
 * preview or export size. `video` is where the video draws inside the recording, grown by the inset
 * so the recording crops its edges.
 */
export function frameLayout(look: Look, canvas: Size, ratio: number) {
  const shrink = ({ width, height }: Size, by: number) => ({
    width: Math.max(width - by * 2, 0),
    height: Math.max(height - by * 2, 0),
  });
  const frame = fitInside(shrink(canvas, 48), ratio);
  const scale = frame.width / 1920;
  const recording = fitInside(shrink(frame, look.padding * scale), ratio);
  const inset = look.inset * scale;
  return {
    frame,
    recording,
    scale,
    radius: look.radius * scale,
    shadow: {
      offsetY: look.shadowOffsetY * scale,
      blur: look.shadowBlur * scale,
      color: `rgb(0 0 0 / ${look.shadowOpacity / 100})`,
    },
    border: {
      width: look.borderWidth * scale,
      color: "rgb(255 255 255 / 0.35)",
    },
    video: {
      x: -inset,
      y: -inset,
      width: recording.width + inset * 2,
      height: recording.height + inset * 2,
    },
  };
}

export type RegionKind = "zoom" | "speed";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  /** How far a zoom zooms in, or how fast a speed region plays. */
  amount: number;
  /** Where a zoom zooms in, as fractions of the video. The middle when left out. */
  centre?: Point;
};

export const REGIONS: Record<
  RegionKind,
  { label: string; hint: string; key: string; amount: number }
> = {
  zoom: { label: "Zoom", hint: "Zoom in on an area", key: "Z", amount: 1.5 },
  speed: { label: "Speed", hint: "Speed up or slow down", key: "S", amount: 2 },
};

/**
 * Adds a region starting at the playhead. It runs up to two seconds, stopping early at the next
 * region or the end. Nothing is added when the playhead is inside a region or there's no room.
 */
export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
): Region[] {
  if (regions.some((region) => covers(region, atMs))) return regions;
  const nextStart = Math.min(
    ...regions
      .filter((region) => region.startMs > atMs)
      .map((region) => region.startMs),
    durationMs,
  );
  const endMs = Math.min(atMs + 2000, nextStart);
  // Shorter than a quarter second, a region is too small to see or grab.
  if (endMs - atMs < 250) return regions;
  const id = Math.max(0, ...regions.map((region) => region.id)) + 1;
  const added = {
    id,
    kind,
    startMs: atMs,
    endMs,
    amount: REGIONS[kind].amount,
  };
  return [...regions, added].sort((a, b) => a.startMs - b.startMs);
}

/** The zoom or speed at `ms`: the region's amount there, or 1 outside every region. */
export function amountAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): number {
  const region = regions.find(
    (region) => region.kind === kind && covers(region, ms),
  );
  return region?.amount ?? 1;
}

/** The kind of region a key adds, like Z for zoom, in either case. */
export function regionKindForKey(key: string): RegionKind | undefined {
  return (Object.keys(REGIONS) as RegionKind[]).find(
    (kind) => REGIONS[kind].key.toLowerCase() === key.toLowerCase(),
  );
}

/**
 * Everything needed to draw the output at `outputMs`, the time after speed regions: the look's
 * layout, the zoom and the source time to show. Export draws each frame from it.
 */
export function frameAt(
  scene: { look: Look; regions: Region[]; canvas: Size; ratio: number },
  outputMs: number,
) {
  return {
    ...frameLayout(scene.look, scene.canvas, scene.ratio),
    zoom: zoomAt(scene.regions, outputMs),
    sourceMs: sourceAt(scene.regions, outputMs),
  };
}

/** How a zoom eases in and out. The stage's CSS transition and `zoomAt` share it. */
export const ZOOM_EASE = { ms: 600, curve: [0.32, 0.72, 0, 1] } as const;

const MIDDLE = { x: 0.5, y: 0.5 };

/**
 * The zoom at an output time. It eases toward `target` from wherever it was at the last region
 * edge, over ZOOM_EASE in output time, the way the stage's CSS transition does as it plays. It
 * zooms on the latest zoom region's centre and keeps it while easing back out.
 */
export function zoomAt(regions: Region[], outputMs: number) {
  let from = 1;
  let target = 1;
  let since = -Infinity;
  let centre: Point = MIDDLE;
  const scaleAt = (ms: number) =>
    from + (target - from) * ease((ms - since) / ZOOM_EASE.ms);
  for (const region of regions.filter(({ kind }) => kind === "zoom")) {
    for (const [edgeMs, scale] of [
      [region.startMs, region.amount],
      [region.endMs, 1],
    ]) {
      const ms = outputAt(regions, edgeMs);
      if (ms > outputMs) return { scale: scaleAt(outputMs), target, centre };
      from = scaleAt(ms);
      target = scale;
      since = ms;
      centre = region.centre ?? MIDDLE;
    }
  }
  return { scale: scaleAt(outputMs), target, centre };
}

/** The output time at a source time. A speed region plays `amount` times as fast, so it's shorter. */
export function outputAt(regions: Region[], sourceMs: number): number {
  return speedRegions(regions).reduce(
    (ms, { startMs, endMs, amount }) =>
      ms - (clamp(sourceMs, startMs, endMs) - startMs) * (1 - 1 / amount),
    sourceMs,
  );
}

/** The source time at an output time, undoing `outputAt`. */
export function sourceAt(regions: Region[], outputMs: number): number {
  return speedRegions(regions).reduce((ms, { startMs, endMs, amount }) => {
    const playedMs = outputMs - outputAt(regions, startMs);
    return ms + clamp(playedMs, 0, (endMs - startMs) / amount) * (amount - 1);
  }, outputMs);
}

/** Labelled marks at a round step that fits about ten labels, with a short mark between each. */
export function rulerMarks(durationMs: number) {
  const durationS = durationMs / 1000;
  const stepS =
    [1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (step) => durationS / step <= 10,
    ) ?? 600;
  const halfStepMs = (stepS * 1000) / 2;
  const marks: { ms: number; isMajor: boolean }[] = [];
  for (let i = 0; i * halfStepMs <= durationMs; i++) {
    marks.push({ ms: i * halfStepMs, isMajor: i % 2 === 0 });
  }
  return marks;
}

/** "0:04" on the ruler. */
export function rulerLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${twoDigits(totalSeconds % 60)}`;
}

function covers(region: Region, ms: number): boolean {
  return ms >= region.startMs && ms < region.endMs;
}

function speedRegions(regions: Region[]): Region[] {
  return regions.filter(({ kind }) => kind === "speed");
}

/** ZOOM_EASE's curve, from 0 to 1 as `progress` goes from 0 to 1, solved like CSS's cubic-bezier. */
function ease(progress: number): number {
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = ZOOM_EASE.curve;
  const bezier = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step++) {
    const t = (low + high) / 2;
    if (bezier(t, x1, x2) < progress) low = t;
    else high = t;
  }
  return bezier(low, y1, y2);
}
