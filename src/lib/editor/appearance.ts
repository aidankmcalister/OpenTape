import { type Size, clamp, fitInside } from "@/lib/geometry";
import type { ExportGradient, ExportStop } from "@/lib/bindings";

export type Fill = {
  kind: "gradient" | "color" | "image";
  preset: number | "custom";
  custom: ExportGradient;
};

export type Appearance = {
  fill: Fill;
  padding: number;
  radius: number;
  inset: number;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetY: number;
  borderWidth: number;
  borderOpacity: number;
  borderColor: string;
};

export type Amount = Exclude<keyof Appearance, "fill" | "borderColor">;

const OLD_BORDER_COLORS: Record<string, string> = {
  light: "#ffffff",
  dark: "#000000",
};

export const GRADIENTS: [string, string, string][] = [
  ["#ffb074", "#e8680a", "#8a2e0a"],
  ["#0f4c5c", "#2a9d8f", "#e9c46a"],
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
  borderOpacity: { label: "Opacity", max: 100, unit: "%" },
};

export const DEFAULT_APPEARANCE: Appearance = {
  fill: { kind: "gradient", preset: 0, custom: presetGradient("gradient", 0) },
  padding: 64,
  radius: 20,
  inset: 0,
  shadowOpacity: 40,
  shadowBlur: 48,
  shadowOffsetY: 16,
  borderWidth: 0,
  borderOpacity: 35,
  borderColor: COLORS[6],
};

export function readAppearance(saved: Partial<Appearance> = {}): Appearance {
  const appearance = { ...DEFAULT_APPEARANCE, ...saved };
  const borderColor = appearance.borderColor.startsWith("#")
    ? appearance.borderColor
    : (OLD_BORDER_COLORS[appearance.borderColor] ??
      DEFAULT_APPEARANCE.borderColor);
  return { ...appearance, borderColor };
}

export function fillGradient(fill: Fill): ExportGradient {
  if (fill.preset !== "custom") return presetGradient(fill.kind, fill.preset);
  if (fill.kind !== "color") return fill.custom;
  const { color } = fill.custom.stops[0];
  return {
    angle: fill.custom.angle,
    stops: [
      { color, at: 0 },
      { color, at: 1 },
    ],
  };
}

function presetGradient(kind: Fill["kind"], preset: number): ExportGradient {
  if (kind === "color") {
    const color = COLORS[preset];
    return {
      angle: 135,
      stops: [
        { color, at: 0 },
        { color, at: 1 },
      ],
    };
  }
  const [from, middle, to] = GRADIENTS[preset];
  const stops = [
    { color: from, at: 0 },
    { color: middle, at: 0.5 },
    { color: to, at: 1 },
  ];
  return { angle: 135, stops };
}

export function fillCss(fill: Fill): string {
  const gradient = fillGradient(fill);
  return fill.kind === "color"
    ? gradient.stops[0].color
    : gradientCss(gradient);
}

export function gradientCss({ angle, stops }: ExportGradient): string {
  const css = [...stops]
    .sort((a, b) => a.at - b.at)
    .map(({ color, at }) => `${color} ${Math.round(at * 100)}%`);
  return `linear-gradient(${angle}deg, ${css.join(", ")})`;
}

export function changeStop(
  gradient: ExportGradient,
  index: number,
  change: Partial<ExportStop>,
): ExportGradient {
  const stops = gradient.stops.map((stop, i) =>
    i === index ? { ...stop, ...change } : stop,
  );
  return { ...gradient, stops };
}

export function clampAmount(amount: Amount, value: number): number {
  return Math.round(clamp(value, 0, AMOUNTS[amount].max));
}

export function frameLayout(
  appearance: Appearance,
  canvas: Size,
  ratio: number,
) {
  const shrink = ({ width, height }: Size, by: number) => ({
    width: Math.max(width - by * 2, 0),
    height: Math.max(height - by * 2, 0),
  });
  const frame = fitInside(shrink(canvas, 48), ratio);
  const scale = frame.width / 1920;
  const recording = fitInside(shrink(frame, appearance.padding * scale), ratio);
  const inset = appearance.inset * scale;
  return {
    frame,
    recording,
    scale,
    radius: appearance.radius * scale,
    shadow: {
      offsetY: appearance.shadowOffsetY * scale,
      blur: appearance.shadowBlur * scale,
      color: `rgb(0 0 0 / ${appearance.shadowOpacity / 100})`,
    },
    border: {
      width: appearance.borderWidth * scale,
      color: borderCss(appearance),
    },
    video: {
      x: -inset,
      y: -inset,
      width: recording.width + inset * 2,
      height: recording.height + inset * 2,
    },
  };
}

function borderCss(appearance: Appearance): string | null {
  if (appearance.borderWidth === 0) return null;
  return `color-mix(in srgb, ${appearance.borderColor} ${appearance.borderOpacity}%, transparent)`;
}

export const MARK_COLORS = {
  white: "#ffffff",
  orange: "#ff7a1a",
  yellow: "#facc15",
  green: "#34c78c",
  blue: "#3d9bff",
  pink: "#f472b6",
};

export type MarkColor = keyof typeof MARK_COLORS;
