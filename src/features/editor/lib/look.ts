/**
 * How the recording is framed: the background behind it, its padding and corners, its shadow
 * and border. Sizes are measured on a frame this wide, so a look stays the same at any preview
 * size or export resolution.
 */
export const FRAME_WIDTH = 1920;

export type FillKind = "gradient" | "color" | "image";

export type Fill = { kind: FillKind; preset: number };

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
  if (fill.kind === "color") return COLORS[fill.preset] ?? COLORS[0];
  const [from, middle, to] = GRADIENTS[fill.preset] ?? GRADIENTS[0];
  return `linear-gradient(135deg, ${from} 0%, ${middle} 55%, ${to} 100%)`;
}

export function clampAmount(amount: Amount, value: number): number {
  return Math.round(Math.min(Math.max(value, 0), AMOUNTS[amount].max));
}
