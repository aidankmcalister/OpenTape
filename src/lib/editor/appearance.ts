import { type Point, type Size, fitInside } from "@/lib/geometry";
import type { ExportGradient, ExportStop } from "@/lib/bindings";
import type { Setting } from "./regions";

export type Fill = {
  kind: "gradient" | "color" | "image";
  preset: number | "custom";
  custom: ExportGradient;
  image: string | null;
};

export const FRAME_SIZES = {
  Auto: null,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

type FrameSize = keyof typeof FRAME_SIZES;

export const FRAME_FITS = ["Letterbox", "Fill"] as const;

type FrameFit = (typeof FRAME_FITS)[number];

export type Appearance = {
  size: FrameSize;
  fit: FrameFit;
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
  cursor: CursorSettings;
};

export type CursorMode = "Hidden" | "Plain" | "Styled";

export type CursorSettings = {
  mode: CursorMode;
  size: number;
  style: CursorStyle;
  alwaysArrow: boolean;
  smoothing: number;
  hidesWhenStill: boolean;
  hidesOutside: boolean;
  loops: boolean;
  stopsBeforeEnd: number;
  angle: number;
  tilts: boolean;
  tilt: number;
  clickEffect: "None" | "Ring" | "Pulse" | "Ripple";
  ringColor: MarkColor;
  ringSize: number;
  ringsRightClicks: boolean;
  presses: boolean;
  removesShakes: boolean;
  shakeThreshold: number;
  steadiesChanges: boolean;
  leadsHovers: boolean;
};

type Amount = {
  [K in keyof Appearance]: Appearance[K] extends number ? K : never;
}[keyof Appearance];

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

export const PRESET_NAMES: Record<"gradient" | "color", string[]> = {
  gradient: [
    "Ember",
    "Lagoon",
    "Ocean",
    "Graphite",
    "Forest",
    "Ruby",
    "Stone",
    "Night",
  ],
  color: ["Orange", "Teal", "Blue", "Gray", "Green", "Red", "Stone", "Black"],
};

export const AMOUNTS = Object.fromEntries(
  Object.entries({
    padding: { label: "Padding", max: 160, unit: "px" },
    radius: { label: "Rounded corners", max: 40, unit: "px" },
    inset: { label: "Inset", max: 40, unit: "px" },
    shadowOpacity: { label: "Opacity", max: 100, unit: "%" },
    shadowBlur: { label: "Blur", max: 100, unit: "px" },
    shadowOffsetY: { label: "Offset Y", max: 64, unit: "px" },
    borderWidth: { label: "Width", max: 8, unit: "px" },
    borderOpacity: { label: "Opacity", max: 100, unit: "%" },
  } satisfies Record<Amount, { label: string; max: number; unit: string }>).map(
    ([key, range]) => [key, { kind: "slider", key, min: 0, step: 1, ...range }],
  ),
) as Record<Amount, Setting>;

export type CursorPaint = {
  fill: string;
  edge: string;
  edgeWidth: number;
  join: "miter" | "round";
};

const OUTLINED: CursorPaint = {
  fill: "#000000",
  edge: "#ffffff",
  edgeWidth: 3,
  join: "round",
};

export const CURSOR_STYLES: Record<
  "macOS" | "Pointy" | "Rounded" | "No stem" | "Dot",
  CursorPaint | null
> = {
  macOS: null,
  Pointy: { ...OUTLINED, edgeWidth: 2.5, join: "miter" },
  Rounded: OUTLINED,
  "No stem": OUTLINED,
  Dot: null,
};

export type CursorStyle = keyof typeof CURSOR_STYLES;

export const DEFAULT_CURSOR: CursorSettings = {
  mode: "Styled",
  size: 100,
  style: "macOS",
  alwaysArrow: false,
  smoothing: 50,
  hidesWhenStill: false,
  hidesOutside: false,
  loops: false,
  stopsBeforeEnd: 0,
  angle: 0,
  tilts: true,
  tilt: 50,
  clickEffect: "None",
  ringColor: "orange",
  ringSize: 40,
  ringsRightClicks: false,
  presses: true,
  removesShakes: true,
  shakeThreshold: 8,
  steadiesChanges: true,
  leadsHovers: true,
};

export const DEFAULT_APPEARANCE: Appearance = {
  size: "Auto",
  fit: "Letterbox",
  fill: {
    kind: "gradient",
    preset: 0,
    custom: presetGradient(0),
    image: null,
  },
  padding: 64,
  radius: 20,
  inset: 0,
  shadowOpacity: 40,
  shadowBlur: 48,
  shadowOffsetY: 16,
  borderWidth: 0,
  borderOpacity: 100,
  borderColor: COLORS[6],
  cursor: DEFAULT_CURSOR,
};

export function readAppearance(saved: Partial<Appearance> = {}): Appearance {
  return {
    ...DEFAULT_APPEARANCE,
    ...saved,
    fill: { ...DEFAULT_APPEARANCE.fill, ...saved.fill },
    cursor: { ...DEFAULT_CURSOR, ...saved.cursor },
  };
}

export function fillGradient({ kind, preset, custom }: Fill): ExportGradient {
  if (kind !== "color")
    return preset === "custom" ? custom : presetGradient(preset);
  const isCustom = preset === "custom";
  const color = isCustom ? custom.stops[0].color : COLORS[preset];
  return {
    angle: isCustom ? custom.angle : 135,
    stops: [
      { color, at: 0 },
      { color, at: 1 },
    ],
  };
}

function presetGradient(preset: number): ExportGradient {
  const [from, middle, to] = GRADIENTS[preset];
  const stops = [
    { color: from, at: 0 },
    { color: middle, at: 0.5 },
    { color: to, at: 1 },
  ];
  return { angle: 135, stops };
}

export function fillCss(
  fill: Fill,
  imageSrc?: (name: string) => string,
): string {
  if (fill.kind === "image" && fill.image && imageSrc)
    return `center / cover no-repeat url("${imageSrc(fill.image)}")`;
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

export function frameShape(appearance: Appearance, ratio: number): number {
  return FRAME_SIZES[appearance.size] ?? ratio;
}

export function frameCrop(appearance: Appearance, ratio: number): Point {
  if (appearance.fit !== "Fill" || appearance.size === "Auto")
    return { x: 1, y: 1 };
  const unit = { width: 1920, height: 1920 / frameShape(appearance, ratio) };
  const hole = shrink(unit, appearance.padding);
  const shape = hole.width / hole.height;
  return { x: Math.max(1, shape / ratio), y: Math.max(1, ratio / shape) };
}

export function recordingIn(
  frame: Size,
  appearance: Appearance,
  ratio: number,
): Size {
  const padding = (appearance.padding * frame.width) / 1920;
  const shown = fitInside(shrink(frame, padding), ratio);
  const crop = frameCrop(appearance, ratio);
  return { width: shown.width * crop.x, height: shown.height * crop.y };
}

function shrink({ width, height }: Size, by: number): Size {
  return {
    width: Math.max(width - by * 2, 0),
    height: Math.max(height - by * 2, 0),
  };
}

export function frameLayout(
  appearance: Appearance,
  canvas: Size,
  ratio: number,
) {
  const frame = fitInside(shrink(canvas, 48), frameShape(appearance, ratio));
  const scale = frame.width / 1920;
  const recording = recordingIn(frame, appearance, ratio);
  const crop = frameCrop(appearance, ratio);
  const picture = {
    width: recording.width / crop.x,
    height: recording.height / crop.y,
  };
  const at = {
    x: (recording.width - picture.width) / 2,
    y: (recording.height - picture.height) / 2,
  };
  const inset = appearance.inset * scale;
  return {
    frame,
    recording,
    picture: { ...at, ...picture },
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
      x: at.x - inset,
      y: at.y - inset,
      width: picture.width + inset * 2,
      height: picture.height + inset * 2,
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
