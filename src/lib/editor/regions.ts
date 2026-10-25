import { type Point, clamp } from "@/lib/geometry";
import { MARK_COLORS, type MarkColor } from "./appearance";

export type RegionKind =
  | "zoom"
  | "speed"
  | "audio"
  | "captions"
  | "annotation"
  | "blur"
  | "highlight"
  | "clickRing"
  | "titleCard";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  amount: number;
  center?: Point;
  settings?: Record<string, SettingValue>;
};

export type SettingValue = string | number | boolean;

export type Setting =
  | {
      kind: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      initial?: number;
    }
  | {
      kind: "choice";
      key: string;
      label?: string;
      options: string[];
      unit?: string;
      disabled?: string[];
      initial?: string;
    }
  | { kind: "color"; key: string; label: string; initial: MarkColor }
  | { kind: "switch"; key: string; label: string; initial?: boolean }
  | {
      kind: "text";
      key: string;
      label: string;
      initial?: string;
      placeholder?: string;
    }
  | { kind: "select"; key: string; label: string; options: string[] }
  | {
      kind: "seconds";
      fields: { key: string; label: string; initial: number }[];
    }
  | { kind: "focus" }
  | { kind: "action"; label: string }
  | { kind: "hint"; text: string | ((region: Region) => string) };

const LANGUAGES: Record<string, string> = {
  English: "EN",
  Spanish: "ES",
  French: "FR",
  German: "DE",
  Japanese: "JA",
};

type Value = (key: string) => SettingValue;

export const REGIONS: Record<
  RegionKind,
  {
    label: string;
    key: string;
    hue: string;
    amount: number;
    lengthMs: number;
    settings: Setting[];
    shows: (value: Value) => string;
    isPreview?: boolean;
  }
> = {
  zoom: {
    label: "Zoom",
    key: "Z",
    hue: "255 122 26",
    amount: 1.5,
    lengthMs: 2000,
    settings: [
      {
        kind: "slider",
        key: "amount",
        label: "Amount",
        min: 1.1,
        max: 3,
        step: 0.1,
        unit: "×",
      },
      {
        kind: "choice",
        key: "focus",
        options: ["Fixed point", "Follow cursor"],
        disabled: ["Follow cursor"],
      },
      { kind: "focus" },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  speed: {
    label: "Speed",
    key: "S",
    hue: "61 155 255",
    amount: 2,
    lengthMs: 2000,
    settings: [
      {
        kind: "slider",
        key: "amount",
        label: "Speed",
        min: 0.25,
        max: 4,
        step: 0.25,
        unit: "×",
      },
      {
        kind: "choice",
        key: "amount",
        options: ["0.5", "1", "2", "4"],
        unit: "×",
      },
      {
        kind: "switch",
        key: "keepPitch",
        label: "Keep audio pitch",
        initial: true,
      },
      {
        kind: "hint",
        text: ({ startMs, endMs, amount }) =>
          `Plays ${seconds(endMs - startMs)} s of recording in ${seconds((endMs - startMs) / amount)} s.`,
      },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  audio: preview(
    "Audio",
    "A",
    "52 199 140",
    4000,
    (value) => `${value("volume")}%`,
    [
      {
        kind: "slider",
        key: "volume",
        label: "Volume",
        min: 0,
        max: 200,
        step: 5,
        unit: "%",
        initial: 80,
      },
      {
        kind: "seconds",
        fields: [
          { key: "fadeIn", label: "Fade in", initial: 0.5 },
          { key: "fadeOut", label: "Fade out", initial: 0.5 },
        ],
      },
      { kind: "hint", text: "Volume goes from 0 to 200 percent." },
    ],
  ),
  captions: preview(
    "Captions",
    "C",
    "167 139 250",
    3000,
    (value) => LANGUAGES[String(value("language"))],
    [
      {
        kind: "select",
        key: "language",
        label: "Language",
        options: Object.keys(LANGUAGES),
      },
      {
        kind: "choice",
        key: "position",
        label: "Position",
        options: ["Bottom", "Middle", "Top"],
      },
      {
        kind: "choice",
        key: "size",
        label: "Size",
        options: ["S", "M", "L"],
        initial: "M",
      },
      {
        kind: "switch",
        key: "highlightWord",
        label: "Highlight spoken word",
        initial: true,
      },
      { kind: "action", label: "Edit transcript" },
    ],
  ),
  annotation: preview(
    "Annotation",
    "N",
    "244 114 182",
    2000,
    (value) => String(value("shape")),
    [
      {
        kind: "choice",
        key: "shape",
        label: "Shape",
        options: ["Arrow", "Box", "Line", "Text"],
      },
      { kind: "color", key: "color", label: "Color", initial: "orange" },
      {
        kind: "choice",
        key: "weight",
        label: "Weight",
        options: ["Thin", "Medium", "Thick"],
        initial: "Medium",
      },
      {
        kind: "choice",
        key: "enters",
        label: "Enters",
        options: ["Draw", "Fade", "Cut"],
      },
      {
        kind: "hint",
        text: "Drag the handles in the preview to move or resize it.",
      },
    ],
  ),
  blur: preview(
    "Blur",
    "B",
    "34 211 238",
    2000,
    (value) => String(value("strength")),
    [
      {
        kind: "choice",
        key: "hideWith",
        label: "Hide with",
        options: ["Blur", "Pixelate", "Block"],
      },
      {
        kind: "choice",
        key: "strength",
        label: "Strength",
        options: ["Soft", "Medium", "Strong"],
      },
      {
        kind: "choice",
        key: "shape",
        label: "Shape",
        options: ["Box", "Ellipse"],
      },
      { kind: "switch", key: "follow", label: "Follow moving content" },
      {
        kind: "hint",
        text: "Drag the box in the preview to cover what you want to hide.",
      },
    ],
  ),
  highlight: preview(
    "Highlight",
    "H",
    "250 204 21",
    2000,
    (value) => colorName(String(value("color"))),
    [
      {
        kind: "choice",
        key: "style",
        label: "Style",
        options: ["Marker", "Box", "Spotlight"],
      },
      { kind: "color", key: "color", label: "Color", initial: "yellow" },
      {
        kind: "slider",
        key: "intensity",
        label: "Intensity",
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
        initial: 40,
      },
      {
        kind: "hint",
        text: "Drag the corners in the preview to set the region.",
      },
    ],
  ),
  clickRing: preview(
    "Click ring",
    "P",
    "148 163 184",
    1000,
    (value) => String(value("style")),
    [
      {
        kind: "choice",
        key: "style",
        label: "Style",
        options: ["Ring", "Pulse", "Ripple"],
      },
      { kind: "color", key: "color", label: "Color", initial: "white" },
      {
        kind: "slider",
        key: "size",
        label: "Size",
        min: 16,
        max: 96,
        step: 4,
        unit: "px",
        initial: 48,
      },
      { kind: "switch", key: "rightClick", label: "Also on right click" },
    ],
  ),
  titleCard: preview(
    "Title card",
    "T",
    "251 113 133",
    3000,
    (value) => String(value("title")),
    [
      { kind: "text", key: "title", label: "Title", initial: "Title" },
      {
        kind: "text",
        key: "subtitle",
        label: "Subtitle",
        placeholder: "Optional",
      },
      {
        kind: "choice",
        key: "layout",
        label: "Layout",
        options: ["Full frame", "Lower third"],
      },
      {
        kind: "choice",
        key: "background",
        label: "Background",
        options: ["Dim video", "Solid"],
      },
    ],
  ),
};

function preview(
  label: string,
  key: string,
  hue: string,
  lengthMs: number,
  shows: (value: Value) => string,
  settings: Setting[],
) {
  return {
    label,
    key,
    hue,
    amount: 0,
    lengthMs,
    settings,
    shows,
    isPreview: true,
  };
}

export function settingValue(region: Region, key: string): SettingValue {
  if (key === "amount") return region.amount;
  return region.settings?.[key] ?? initialValue(region.kind, key);
}

export function blockValue(region: Region): string {
  return REGIONS[region.kind].shows((key) => settingValue(region, key));
}

export function changeSetting(
  region: Region,
  key: string,
  value: SettingValue,
): Partial<Region> {
  return key === "amount"
    ? { amount: Number(value) }
    : { settings: { ...region.settings, [key]: value } };
}

function initialValue(kind: RegionKind, key: string): SettingValue {
  for (const setting of REGIONS[kind].settings) {
    if (setting.kind === "seconds") {
      const field = setting.fields.find((field) => field.key === key);
      if (field) return field.initial;
    } else if ("key" in setting && setting.key === key) {
      return initialOf(setting);
    }
  }
  return "";
}

function initialOf(setting: Setting): SettingValue {
  switch (setting.kind) {
    case "slider":
      return setting.initial ?? setting.min;
    case "choice":
      return setting.initial ?? setting.options[0];
    case "select":
      return setting.options[0];
    case "color":
      return setting.initial;
    case "switch":
      return setting.initial ?? false;
    case "text":
      return setting.initial ?? "";
    default:
      return "";
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function colorName(color: string): string {
  return color in MARK_COLORS
    ? color.charAt(0).toUpperCase() + color.slice(1)
    : "Custom";
}

export const ALL_KINDS = Object.keys(REGIONS) as RegionKind[];

export const KINDS = ALL_KINDS.filter((kind) => !REGIONS[kind].isPreview);

export const MIN_REGION_MS = 200;

const SNAP_MS = 100;

export type RegionDrag = "move" | "start" | "end";

export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
): Region[] {
  if (durationMs < MIN_REGION_MS) return regions;
  const endMs = Math.min(atMs + REGIONS[kind].lengthMs, durationMs);
  const startMs = Math.max(0, Math.min(atMs, endMs - MIN_REGION_MS));
  const amount = REGIONS[kind].amount;
  return [...regions, { id: nextId(regions), kind, startMs, endMs, amount }];
}

export function nextId(regions: Region[]): number {
  return Math.max(0, ...regions.map((region) => region.id)) + 1;
}

export function dragRegions(
  regions: Region[],
  ids: number[],
  drag: RegionDrag,
  deltaMs: number,
  durationMs: number,
): Region[] {
  const dragged = regions.filter((region) => ids.includes(region.id));
  if (dragged.length === 0) return regions;
  const spans = new Map(
    dragged.map((region) => [
      region.id,
      drag === "move"
        ? moved(dragged, region, deltaMs, durationMs)
        : stretched(region, drag, deltaMs, durationMs),
    ]),
  );
  const changed = regions.map((region) => {
    const span = spans.get(region.id);
    return span &&
      (span.startMs !== region.startMs || span.endMs !== region.endMs)
      ? { ...region, ...span }
      : region;
  });
  return changed.every((region, index) => region === regions[index])
    ? regions
    : changed;
}

function moved(
  group: Region[],
  region: Region,
  deltaMs: number,
  durationMs: number,
) {
  const first = Math.min(...group.map(({ startMs }) => startMs));
  const last = Math.max(...group.map(({ endMs }) => endMs));
  const shift = clamp(snap(first + deltaMs) - first, -first, durationMs - last);
  return { startMs: region.startMs + shift, endMs: region.endMs + shift };
}

function stretched(
  region: Region,
  edge: "start" | "end",
  deltaMs: number,
  durationMs: number,
) {
  const { startMs, endMs } = region;
  return edge === "start"
    ? {
        startMs: clamp(snap(startMs + deltaMs), 0, endMs - MIN_REGION_MS),
        endMs,
      }
    : {
        startMs,
        endMs: clamp(
          snap(endMs + deltaMs),
          startMs + MIN_REGION_MS,
          durationMs,
        ),
      };
}

function snap(ms: number): number {
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

export function laneKinds(regions: Region[]): RegionKind[] {
  return ALL_KINDS.filter((kind) =>
    regions.some((region) => region.kind === kind),
  );
}

export function winnerAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): Region | undefined {
  return regions
    .filter((region) => region.kind === kind && covers(region, ms))
    .sort((a, b) => b.startMs - a.startMs || b.id - a.id)[0];
}

export function coveredStretches(regions: Region[], region: Region) {
  const shown = resolveOverlaps(regions, region.kind).filter(
    ({ id }) => id === region.id,
  );
  const covered: { startMs: number; endMs: number }[] = [];
  let atMs = region.startMs;
  for (const piece of shown) {
    if (piece.startMs > atMs)
      covered.push({ startMs: atMs, endMs: piece.startMs });
    atMs = Math.max(atMs, piece.endMs);
  }
  if (atMs < region.endMs) covered.push({ startMs: atMs, endMs: region.endMs });
  return covered;
}

export function dragSpan<T extends Pick<Region, "id" | "startMs" | "endMs">>(
  regions: T[],
  id: number,
  drag: RegionDrag,
  deltaMs: number,
  durationMs: number,
): T[] {
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

export function changeRegion(
  regions: Region[],
  id: number,
  change: Partial<Pick<Region, "amount" | "center" | "settings">>,
): Region[] {
  const region = regions.find((region) => region.id === id);
  if (!region) return regions;
  const changed = { ...region, ...change };
  return JSON.stringify(changed) === JSON.stringify(region)
    ? regions
    : regions.map((other) => (other === region ? changed : other));
}

export function removeRegions(regions: Region[], ids: number[]): Region[] {
  return regions.some((region) => ids.includes(region.id))
    ? regions.filter((region) => !ids.includes(region.id))
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
  const region = resolveOverlaps(regions, kind).find((region) =>
    covers(region, ms),
  );
  return region?.amount ?? 1;
}

export function resolveOverlaps(regions: Region[], kind: RegionKind): Region[] {
  const ofKind = regions.filter((region) => region.kind === kind);
  const edges = [
    ...new Set(ofKind.flatMap(({ startMs, endMs }) => [startMs, endMs])),
  ].sort((a, b) => a - b);
  const pieces: Region[] = [];
  edges.slice(1).forEach((endMs, index) => {
    const startMs = edges[index];
    const [latest] = ofKind
      .filter((region) => covers(region, startMs))
      .sort((a, b) => b.startMs - a.startMs || b.id - a.id);
    if (!latest) return;
    const last = pieces[pieces.length - 1];
    if (last?.id === latest.id && last.endMs === startMs) last.endMs = endMs;
    else pieces.push({ ...latest, startMs, endMs });
  });
  return pieces;
}

export function regionKindForKey(key: string): RegionKind | undefined {
  return (Object.keys(REGIONS) as RegionKind[]).find(
    (kind) => REGIONS[kind].key.toLowerCase() === key.toLowerCase(),
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

function covers(region: Region, ms: number): boolean {
  return ms >= region.startMs && ms < region.endMs;
}

function speedRegions(regions: Region[]): Region[] {
  return resolveOverlaps(regions, "speed");
}
