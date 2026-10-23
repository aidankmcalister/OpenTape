import { clamp, fitInside, type Point, type Size } from "@/lib/geometry";
import type { ExportGradient, ExportLayout } from "@/lib/bindings";
import { twoDigits } from "@/lib/time";
import { FRAME_MS } from "./timeline";

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

export function fillGradient(fill: Fill): ExportGradient {
  if (fill.kind === "color") {
    const color = COLORS[fill.preset];
    return {
      angle: 135,
      stops: [
        { color, at: 0 },
        { color, at: 1 },
      ],
    };
  }
  const [from, middle, to] = GRADIENTS[fill.preset];
  const stops = [
    { color: from, at: 0 },
    { color: middle, at: 0.55 },
    { color: to, at: 1 },
  ];
  return { angle: 135, stops };
}

export function fillCss(fill: Fill): string {
  if (fill.kind === "color") return COLORS[fill.preset];
  const { angle, stops } = fillGradient(fill);
  const css = stops.map(({ color, at }) => `${color} ${Math.round(at * 100)}%`);
  return `linear-gradient(${angle}deg, ${css.join(", ")})`;
}

export function clampAmount(amount: Amount, value: number): number {
  return Math.round(clamp(value, 0, AMOUNTS[amount].max));
}

export function amountFromShare(amount: Amount, share: number): number {
  return clampAmount(amount, share * AMOUNTS[amount].max);
}

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

export function exportLayout(
  look: Look,
  video: Size,
  zoom: number[],
): ExportLayout {
  const ratio = video.width / video.height;
  // The frame whose 1920-relative padding leaves the recording exactly its own size, as frameLayout does.
  const paddingShare = ((2 * look.padding) / 1920) * Math.max(1, ratio);
  const width = even(video.width / (1 - paddingShare));
  const height = even(width / ratio);
  const scale = width / 1920;
  return {
    width,
    height,
    recording: {
      x: Math.round((width - video.width) / 2),
      y: Math.round((height - video.height) / 2),
      width: video.width,
      height: video.height,
    },
    radius: look.radius * scale,
    shadow: {
      offsetY: look.shadowOffsetY * scale,
      blur: look.shadowBlur * scale,
      opacity: look.shadowOpacity / 100,
    },
    background: fillGradient(look.fill),
    zoom,
  };
}

function even(value: number): number {
  return Math.round(value / 2) * 2;
}

export type RegionKind = "zoom" | "speed";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  amount: number;
  centre?: Point;
};

export const REGIONS: Record<
  RegionKind,
  { label: string; hint: string; key: string; amount: number }
> = {
  zoom: { label: "Zoom", hint: "Zoom in on an area", key: "Z", amount: 1.5 },
  speed: { label: "Speed", hint: "Speed up or slow down", key: "S", amount: 2 },
};

const MIN_REGION_MS = 250;

export type RegionDrag = "move" | "start" | "end";

export type Project = { look: Look; regions: Region[] };

export const NEW_PROJECT: Project = { look: DEFAULT_LOOK, regions: [] };

export function editRegions(
  project: Project,
  edit: (regions: Region[]) => Region[],
): Project {
  const regions = edit(project.regions);
  return regions === project.regions ? project : { ...project, regions };
}

export function changeLook(project: Project, change: Partial<Look>): Project {
  const look = { ...project.look, ...change };
  return JSON.stringify(look) === JSON.stringify(project.look)
    ? project
    : { ...project, look };
}

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
  if (endMs - atMs < MIN_REGION_MS) return regions;
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

export function dragRegion(
  regions: Region[],
  id: number,
  drag: RegionDrag,
  deltaMs: number,
  durationMs: number,
): Region[] {
  const region = regions.find((region) => region.id === id);
  if (!region) return regions;
  const others = regions.filter((other) => other !== region);
  const floor = Math.max(
    0,
    ...others
      .filter((other) => other.endMs <= region.startMs)
      .map((other) => other.endMs),
  );
  const ceiling = Math.min(
    durationMs,
    ...others
      .filter((other) => other.startMs >= region.endMs)
      .map((other) => other.startMs),
  );
  let { startMs, endMs } = region;
  if (drag === "move") {
    const shift = clamp(deltaMs, floor - startMs, ceiling - endMs);
    startMs += shift;
    endMs += shift;
  } else if (drag === "start") {
    startMs = clamp(startMs + deltaMs, floor, endMs - MIN_REGION_MS);
  } else {
    endMs = clamp(endMs + deltaMs, startMs + MIN_REGION_MS, ceiling);
  }
  if (startMs === region.startMs && endMs === region.endMs) return regions;
  return regions.map((other) =>
    other === region ? { ...region, startMs, endMs } : other,
  );
}

export function removeRegion(regions: Region[], id: number): Region[] {
  return regions.some((region) => region.id === id)
    ? regions.filter((region) => region.id !== id)
    : regions;
}

export function removeRegionAt(regions: Region[], ms: number): Region[] {
  return regions.filter((region) => !covers(region, ms));
}

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

export function regionKindForKey(key: string): RegionKind | undefined {
  return (Object.keys(REGIONS) as RegionKind[]).find(
    (kind) => REGIONS[kind].key.toLowerCase() === key.toLowerCase(),
  );
}

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

export const ZOOM_EASE = { ms: 600, curve: [0.32, 0.72, 0, 1] } as const;

const MIDDLE = { x: 0.5, y: 0.5 };

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

export function zoomTrack(regions: Region[], durationMs: number): number[] {
  const frames = Math.ceil(durationMs / FRAME_MS) + 1;
  return Array.from(
    { length: frames },
    (_, frame) => zoomAt(regions, frame * FRAME_MS).scale,
  );
}

export function outputAt(regions: Region[], sourceMs: number): number {
  return speedRegions(regions).reduce(
    (ms, { startMs, endMs, amount }) =>
      ms - (clamp(sourceMs, startMs, endMs) - startMs) * (1 - 1 / amount),
    sourceMs,
  );
}

export function sourceAt(regions: Region[], outputMs: number): number {
  return speedRegions(regions).reduce((ms, { startMs, endMs, amount }) => {
    const playedMs = outputMs - outputAt(regions, startMs);
    return ms + clamp(playedMs, 0, (endMs - startMs) / amount) * (amount - 1);
  }, outputMs);
}

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
