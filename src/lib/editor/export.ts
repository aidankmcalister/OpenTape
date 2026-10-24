import type { Size } from "@/lib/geometry";
import type {
  ExportFormat,
  ExportLayout,
  ExportOptions,
  PixelRect,
} from "@/lib/bindings";
import { type Appearance, BORDER_COLORS, fillGradient } from "./appearance";
import { type Clip, cutSpans } from "./clips";
import { outputAt, type Region } from "./regions";
import { zoomTrack } from "./zoom";

export function exportLayout(
  appearance: Appearance,
  video: Size,
  regions: Region[] = [],
  durationMs = 0,
  clips: Clip[] = [],
): ExportLayout {
  const ratio = video.width / video.height;
  const paddingShare = ((2 * appearance.padding) / 1920) * Math.max(1, ratio);
  const width = even(video.width / (1 - paddingShare));
  const height = even(width / ratio);
  const scale = width / 1920;
  const recording = {
    x: Math.round((width - video.width) / 2),
    y: Math.round((height - video.height) / 2),
    width: video.width,
    height: video.height,
  };
  const inset = appearance.inset * scale;
  const { tint } = BORDER_COLORS[appearance.borderColor];
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
      tint && appearance.borderWidth > 0
        ? { ...tint, width: appearance.borderWidth * scale }
        : null,
    radius: appearance.radius * scale,
    shadow: {
      offsetY: appearance.shadowOffsetY * scale,
      blur: appearance.shadowBlur * scale,
      opacity: appearance.shadowOpacity / 100,
    },
    background: fillGradient(appearance.fill),
    zoom: zoomTrack(regions, durationMs),
    speed: regions
      .filter(({ kind }) => kind === "speed")
      .map(({ startMs, endMs, amount }) => ({
        start: startMs / 1000,
        end: endMs / 1000,
        amount,
      })),
    cuts: cutSpans(clips, durationMs).map(({ startMs, endMs }) => ({
      start: outputAt(regions, startMs) / 1000,
      end: outputAt(regions, endMs) / 1000,
    })),
  };
}

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "4K": 2160 };

export type Resolution = keyof typeof RESOLUTIONS;

export function scaleLayout(
  layout: ExportLayout,
  height: number,
): ExportLayout {
  const scale = height / layout.height;
  const { shadow, border } = layout;
  const scaled = (rect: PixelRect) => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    ...layout,
    width: even(layout.width * scale),
    height: even(height),
    recording: scaled(layout.recording),
    video: scaled(layout.video),
    border: border && { ...border, width: border.width * scale },
    radius: layout.radius * scale,
    shadow: {
      ...shadow,
      offsetY: shadow.offsetY * scale,
      blur: shadow.blur * scale,
    },
  };
}

export const QUALITIES = {
  best: {
    label: "Best",
    bitsPerPixel: 12,
    hint: "Largest file, closest to the original.",
  },
  balanced: {
    label: "Balanced",
    bitsPerPixel: 8,
    hint: "Good for sharing. A little smaller than the original.",
  },
  small: {
    label: "Small",
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
