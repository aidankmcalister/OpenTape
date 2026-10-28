import type { Size } from "@/lib/geometry";
import type { ExportFormat, ExportLayout, ExportOptions } from "@/lib/bindings";
import {
  type Appearance,
  frameCrop,
  frameShape,
  fillGradient,
  recordingIn,
} from "./appearance";
import { type Clip, cutSpans, keptClips } from "./clips";
import {
  type CursorTrack,
  exportCursor,
  exportRings,
  type RingEvent,
} from "./cursor";
import { blurOf, outputAt, type Region, sameKind } from "./regions";
import { DEFAULT_SOUND, mixVolumes, type SoundSettings } from "./sound";
import { FRAME_MS } from "./timeline";
import { zoomTrack } from "./zoom";

export type ExportTimeline = {
  regions: Region[];
  durationMs: number;
  clips: Clip[];
  rings: RingEvent[];
  cursor: CursorTrack;
  sound: SoundSettings;
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
    sound = DEFAULT_SOUND,
  }: Partial<ExportTimeline> = {},
  side?: number,
): ExportLayout {
  const ratio = video.width / video.height;
  const shape = frameShape(appearance, ratio);
  const crop = frameCrop(appearance, ratio);
  const unit = { width: 1920, height: 1920 / shape };
  const grow =
    (video.width * crop.x) / recordingIn(unit, appearance, ratio).width;
  const short =
    appearance.size === "Auto"
      ? unit.height
      : Math.min(unit.width, unit.height);
  const fit = side ? side / (short * grow) : 1;
  const width = even(unit.width * grow * fit);
  const height = even(unit.height * grow * fit);
  const scale = width / 1920;
  const shown = { width: video.width * fit, height: video.height * fit };
  const recording = {
    x: Math.round((width - shown.width * crop.x) / 2),
    y: Math.round((height - shown.height * crop.y) / 2),
    width: shown.width * crop.x,
    height: shown.height * crop.y,
  };
  const inset = appearance.inset * scale;
  const placed = {
    x: recording.x + (recording.width - shown.width) / 2 - inset,
    y: recording.y + (recording.height - shown.height) / 2 - inset,
    width: shown.width + inset * 2,
    height: shown.height + inset * 2,
  };
  const zoom = zoomTrack(regions, durationMs, cursor, crop);
  const kept = keptClips(clips, durationMs);
  return {
    width,
    height,
    recording,
    video: placed,
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
    backgroundImage:
      appearance.fill.kind === "image" ? appearance.fill.image : null,
    zoom,
    zoomRate: 1000 / FRAME_MS,
    speed: sameKind(regions, "speed").map(({ startMs, endMs, amount }) => ({
      start: startMs / 1000,
      end: endMs / 1000,
      amount,
    })),
    cuts: cutSpans(clips, durationMs).map(({ startMs, endMs }) => ({
      start: outputAt(regions, startMs) / 1000,
      end: outputAt(regions, endMs) / 1000,
    })),
    blurs: sameKind(regions, "blur").map((blur) => {
      const { box, radius } = blurOf(blur);
      return {
        start: outputAt(regions, blur.startMs) / 1000,
        end: outputAt(regions, blur.endMs) / 1000,
        ...box,
        radius: radius * scale,
      };
    }),
    rings: exportRings(rings, regions, scale),
    cursor: cursor
      ? exportCursor(
          cursor,
          regions,
          appearance.cursor,
          durationMs,
          { zoom, recording, video: placed },
          { startMs: kept[0].startMs, endMs: kept[kept.length - 1].endMs },
        )
      : null,
    sound: mixVolumes(sound),
  };
}

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "4K": 2160 };

type Resolution = keyof typeof RESOLUTIONS;

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

export function readExport(saved: unknown): ExportSettings {
  const known = { ...DEFAULT_EXPORT, ...(saved as Partial<ExportSettings>) };
  return {
    format: known.format === "gif" ? "gif" : "mp4",
    frameRate: known.frameRate === 30 ? 30 : 60,
    resolution:
      known.resolution in RESOLUTIONS
        ? known.resolution
        : DEFAULT_EXPORT.resolution,
    quality:
      known.quality in QUALITIES ? known.quality : DEFAULT_EXPORT.quality,
    to: known.to === "clipboard" ? "clipboard" : "file",
  };
}

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
