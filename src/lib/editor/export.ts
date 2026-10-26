import type { Size } from "@/lib/geometry";
import type { ExportFormat, ExportLayout, ExportOptions } from "@/lib/bindings";
import {
  type Appearance,
  frameShape,
  fillGradient,
  recordingIn,
} from "./appearance";
import { type Clip, cutSpans } from "./clips";
import {
  type CursorTrack,
  exportCursor,
  exportRings,
  type RingEvent,
} from "./cursor";
import { outputAt, type Region, resolveOverlaps } from "./regions";
import { FRAME_MS } from "./timeline";
import { zoomTrack } from "./zoom";

export type ExportTimeline = {
  regions: Region[];
  durationMs: number;
  clips: Clip[];
  rings: RingEvent[];
  cursor: CursorTrack;
};

export function exportLayout(
  appearance: Appearance,
  video: Size,
  {
    regions = [],
    durationMs = 0,
    clips = [],
    rings = [],
    cursor,
  }: Partial<ExportTimeline> = {},
  side?: number,
): ExportLayout {
  const ratio = video.width / video.height;
  const shape = frameShape(appearance, ratio);
  const unit = { width: 1920, height: 1920 / shape };
  const grow = video.width / recordingIn(unit, appearance, ratio).width;
  const short =
    appearance.size === "Auto"
      ? unit.height
      : Math.min(unit.width, unit.height);
  const fit = side ? side / (short * grow) : 1;
  const width = even(unit.width * grow * fit);
  const height = even(unit.height * grow * fit);
  const scale = width / 1920;
  const recording = {
    x: Math.round((width - video.width * fit) / 2),
    y: Math.round((height - video.height * fit) / 2),
    width: video.width * fit,
    height: video.height * fit,
  };
  const inset = appearance.inset * scale;
  return {
    width,
    height,
    recording,
    video: {
      x: recording.x - inset,
      y: recording.y - inset,
      width: recording.width + inset * 2,
      height: recording.height + inset * 2,
    },
    border:
      appearance.borderWidth > 0
        ? {
            color: appearance.borderColor,
            opacity: appearance.borderOpacity / 100,
            width: appearance.borderWidth * scale,
          }
        : null,
    radius: appearance.radius * scale,
    shadow: {
      offsetY: appearance.shadowOffsetY * scale,
      blur: appearance.shadowBlur * scale,
      opacity: appearance.shadowOpacity / 100,
    },
    background: fillGradient(appearance.fill),
    zoom: zoomTrack(regions, durationMs, cursor),
    zoomRate: 1000 / FRAME_MS,
    speed: resolveOverlaps(regions, "speed").map(
      ({ startMs, endMs, amount }) => ({
        start: startMs / 1000,
        end: endMs / 1000,
        amount,
      }),
    ),
    cuts: cutSpans(clips, durationMs).map(({ startMs, endMs }) => ({
      start: outputAt(regions, startMs) / 1000,
      end: outputAt(regions, endMs) / 1000,
    })),
    rings: exportRings(rings, regions, scale),
    cursor: cursor
      ? exportCursor(cursor, regions, appearance.cursor, durationMs)
      : null,
  };
}

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "4K": 2160 };

export type Resolution = keyof typeof RESOLUTIONS;

export const QUALITIES = {
  best: {
    bitsPerPixel: 12,
    hint: "Largest file, closest to the original.",
  },
  balanced: {
    bitsPerPixel: 8,
    hint: "Good for sharing. A little smaller than the original.",
  },
  small: {
    bitsPerPixel: 4,
    hint: "Smallest file, for messages and chat.",
  },
};

export type ExportSettings = {
  format: ExportFormat;
  frameRate: 30 | 60;
  resolution: Resolution;
  quality: keyof typeof QUALITIES;
  to: "file" | "clipboard";
};

export const DEFAULT_EXPORT: ExportSettings = {
  format: "mp4",
  frameRate: 60,
  resolution: "1080p",
  quality: "balanced",
  to: "file",
};

export function exportOptions(settings: ExportSettings): ExportOptions {
  return {
    format: settings.format,
    frameRate: settings.frameRate,
    bitsPerPixel: QUALITIES[settings.quality].bitsPerPixel,
    toClipboard: settings.to === "clipboard",
  };
}

export function aboutMegabytes(
  layout: ExportLayout,
  durationMs: number,
  settings: ExportSettings,
): number | null {
  if (settings.format === "gif") return null;
  const { bitsPerPixel } = QUALITIES[settings.quality];
  const bits =
    (layout.width * layout.height * bitsPerPixel * durationMs) / 1000;
  return Math.round(bits / 8e5) / 10;
}

function even(value: number): number {
  return Math.round(value / 2) * 2;
}
