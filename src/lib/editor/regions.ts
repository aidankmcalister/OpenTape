import { type Point, type Rect, clamp } from "@/lib/geometry";
import type { MarkColor } from "./appearance";

export type RegionKind = "zoom" | "speed" | "blur" | "keys";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  amount: number;
  center?: Point;
  box?: Rect;
  settings?: Record<string, SettingValue>;
  isSuggested?: boolean;
  path?: (Point & { afterMs: number })[];
};

export type Span = { startMs: number; endMs: number };

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
      help?: string;
    }
  | {
      kind: "choice";
      key: string;
      label?: string;
      options: readonly string[];
      unit?: string;
      disabled?: string[];
      initial?: string;
    }
  | { kind: "color"; key: string; label: string; initial: MarkColor }
  | {
      kind: "shortcut";
      key: string;
      label: string;
      initial: string;
    }
  | { kind: "menu"; key: string; label: string; options: readonly string[] }
  | {
      kind: "switch";
      key: string;
      label: string;
      initial?: boolean;
      help?: string;
    }
  | { kind: "focus" }
  | { kind: "hint"; text: string | ((region: Region) => string) };

type Value = (key: string) => SettingValue;

const BLUR_RADII = { Soft: 8, Medium: 16, Hard: 32 };

export const REGIONS: Record<
  RegionKind,
  {
    label: string;
    key: string;
    /** "r g b" for fills, rings and bars. */
    hue: string;
    /** "r g b" for the icon, name, value and keycaps, wherever the kind shows. */
    text: string;
    amount: number;
    lengthMs: number;
    settings: Setting[];
    shows: (value: Value) => string;
    /** Its blocks show the value as keycaps, without the icon and label. */
    showsKeycaps?: boolean;
  }
> = {
  zoom: {
    label: "Zoom",
    key: "Z",
    hue: "255 122 26",
    text: "255 165 102",
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
      },
      { kind: "focus" },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  speed: {
    label: "Speed",
    key: "S",
    hue: "61 155 255",
    text: "140 196 255",
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
        kind: "hint",
        text: ({ startMs, endMs, amount }) =>
          `Plays ${seconds(endMs - startMs)} s of recording in ${seconds((endMs - startMs) / amount)} s.`,
      },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  blur: {
    label: "Blur",
    key: "B",
    hue: "34 211 238",
    text: "103 232 249",
    amount: 0,
    lengthMs: 2000,
    settings: [
      {
        kind: "choice",
        key: "strength",
        label: "Strength",
        options: Object.keys(BLUR_RADII),
        initial: "Medium",
      },
    ],
    shows: (value) => String(value("strength")),
  },
  keys: {
    label: "Keystrokes",
    key: "K",
    hue: "163 230 53",
    text: "190 242 100",
    amount: 0,
    lengthMs: 1500,
    settings: [
      {
        kind: "shortcut",
        key: "text",
        label: "Text",
        initial: "⌘K",
      },
    ],
    shows: (value) => String(value("text")),
    showsKeycaps: true,
  },
};

export function blurOf(region: Region) {
  const strength = settingValue(region, "strength") as keyof typeof BLUR_RADII;
  return {
    box: region.box ?? { x: 0.35, y: 0.4, width: 0.3, height: 0.2 },
    radius: BLUR_RADII[strength],
  };
}

export type BoxDrag = "move" | "nw" | "ne" | "sw" | "se";

export function draggedBox(box: Rect, drag: BoxDrag, by: Point): Rect {
  if (drag === "move")
    return {
      ...box,
      x: clamp(box.x + by.x, 0, 1 - box.width),
      y: clamp(box.y + by.y, 0, 1 - box.height),
    };
  const side = (at: number, size: number, delta: number, isStart: boolean) => {
    const end = at + size;
    if (!isStart) return [at, clamp(end + delta, at + 0.05, 1) - at];
    const start = clamp(at + delta, 0, end - 0.05);
    return [start, end - start];
  };
  const [x, width] = side(box.x, box.width, by.x, drag.includes("w"));
  const [y, height] = side(box.y, box.height, by.y, drag.includes("n"));
  return { x, y, width, height };
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
  const setting = REGIONS[kind].settings.find(
    (setting) => "key" in setting && setting.key === key,
  );
  return setting ? initialOf(setting) : "";
}

export function initialOf(setting: Setting): SettingValue {
  switch (setting.kind) {
    case "slider":
      return setting.initial ?? setting.min;
    case "choice":
      return setting.initial ?? setting.options[0];
    case "menu":
      return setting.options[0];
    case "color":
    case "shortcut":
      return setting.initial;
    case "switch":
      return setting.initial ?? false;
    default:
      return "";
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export const ALL_KINDS = Object.keys(REGIONS) as RegionKind[];

/** The kind whose blocks show keycaps: the recorded shortcuts. */
export const KEYCAPS_KIND = ALL_KINDS.find(
  (kind) => REGIONS[kind].showsKeycaps,
) as RegionKind;

export const MIN_REGION_MS = 200;

const SNAP_MS = 100;

export type RegionDrag = "move" | "start" | "end";

export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
  minMs = MIN_REGION_MS,
): Region[] {
  // Inside a block of its kind, it goes to the next gap.
  atMs = regionAt(regions, kind, atMs)?.endMs ?? atMs;
  const [gap] = gapsBetween(sameKind(regions, kind), 0, durationMs)
    .filter(({ startMs, endMs }) => endMs - startMs >= minMs)
    .sort(
      (a, b) => distance(a, atMs) - distance(b, atMs) || b.startMs - a.startMs,
    );
  if (!gap) return regions;
  const startMs = clamp(atMs, gap.startMs, gap.endMs - minMs);
  const endMs = Math.min(startMs + REGIONS[kind].lengthMs, gap.endMs);
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
  {
    minMs = MIN_REGION_MS,
    edgesMs = [],
    withinMs = 0,
  }: {
    minMs?: number;
    /** Times it catches besides the grid and the other blocks' edges, within `withinMs`. */
    edgesMs?: number[];
    withinMs?: number;
  } = {},
): Region[] {
  const dragged = regions.filter((region) => ids.includes(region.id));
  if (dragged.length === 0) return regions;
  const edges = snapEdges(regions, ids, edgesMs);
  const catches = (ms: number) =>
    edges
      .filter((edge) => Math.abs(edge - ms) <= withinMs)
      .sort((a, b) => Math.abs(a - ms) - Math.abs(b - ms))[0];
  const shift =
    drag === "move"
      ? movedBy(regions, dragged, deltaMs, durationMs, catches)
      : 0;
  const changed = regions.map((region) => {
    if (!dragged.includes(region)) return region;
    const span =
      drag === "move"
        ? { startMs: region.startMs + shift, endMs: region.endMs + shift }
        : stretched(
            region,
            sameKind(regions, region.kind),
            drag,
            deltaMs,
            durationMs,
            minMs,
            (ms) => catches(ms) ?? snap(ms),
          );
    return span.startMs !== region.startMs || span.endMs !== region.endMs
      ? { ...region, ...span, isSuggested: undefined }
      : region;
  });
  return changed.every((region, index) => region === regions[index])
    ? regions
    : changed;
}

function movedBy(
  regions: Region[],
  group: Region[],
  deltaMs: number,
  durationMs: number,
  catches: (ms: number) => number | undefined,
): number {
  const { startMs: first, endMs: last } = spanOf(group);
  // The start or the end catches the nearest edge; else the start goes to the grid.
  const [wanted = snap(first + deltaMs) - first] = [first, last]
    .flatMap((edge) => {
      const at = catches(edge + deltaMs);
      return at === undefined ? [] : [at - edge];
    })
    .sort((a, b) => Math.abs(a - deltaMs) - Math.abs(b - deltaMs));
  const others = regions.filter((region) => !group.includes(region));
  const blockers = group.flatMap((moving) =>
    sameKind(others, moving.kind).map((other) => ({ moving, other })),
  );
  const fits = (shift: number) =>
    shift >= -first &&
    shift <= durationMs - last &&
    blockers.every(
      ({ moving, other }) =>
        other.endMs <= moving.startMs + shift ||
        other.startMs >= moving.endMs + shift,
    );
  const candidates = [
    wanted,
    -first,
    durationMs - last,
    ...blockers.flatMap(({ moving, other }) => [
      other.startMs - moving.endMs,
      other.endMs - moving.startMs,
    ]),
  ];
  const [best = 0] = candidates
    .filter(fits)
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
  return best;
}

/** Edges a drag of `ids` catches: `edgesMs` and the other blocks' starts and ends. */
export function snapEdges(
  regions: Region[],
  ids: number[],
  edgesMs: number[],
): number[] {
  return [
    ...edgesMs,
    ...regions
      .filter(({ id }) => !ids.includes(id))
      .flatMap(({ startMs, endMs }) => [startMs, endMs]),
  ];
}

/** From the first start to the last end. */
export function spanOf(spans: Span[]): Span {
  return {
    startMs: Math.min(...spans.map(({ startMs }) => startMs)),
    endMs: Math.max(...spans.map(({ endMs }) => endMs)),
  };
}

export function stretched(
  span: Span,
  others: Span[],
  edge: "start" | "end",
  deltaMs: number,
  durationMs: number,
  minMs: number,
  round = (ms: number) => ms,
): Span {
  const { startMs, endMs } = span;
  const shortest = Math.min(minMs, endMs - startMs);
  if (edge === "start") {
    const floor = Math.max(
      0,
      ...others.filter((o) => o.endMs <= startMs).map((o) => o.endMs),
    );
    return {
      startMs: clamp(round(startMs + deltaMs), floor, endMs - shortest),
      endMs,
    };
  }
  const ceiling = Math.min(
    durationMs,
    ...others.filter((o) => o.startMs >= endMs).map((o) => o.startMs),
  );
  return {
    startMs,
    endMs: clamp(round(endMs + deltaMs), startMs + shortest, ceiling),
  };
}

const byKind = new WeakMap<Region[], Partial<Record<RegionKind, Region[]>>>();

export function sameKind(regions: Region[], kind: RegionKind): Region[] {
  const kinds = byKind.get(regions) ?? {};
  byKind.set(regions, kinds);
  return (kinds[kind] ??= regions
    .filter((region) => region.kind === kind)
    .sort((a, b) => a.startMs - b.startMs));
}

export function gapsBetween(spans: Span[], fromMs: number, toMs: number) {
  const gaps: Span[] = [];
  let atMs = fromMs;
  for (const span of [...spans].sort((a, b) => a.startMs - b.startMs)) {
    if (span.startMs > atMs) gaps.push({ startMs: atMs, endMs: span.startMs });
    atMs = Math.max(atMs, span.endMs);
  }
  if (atMs < toMs) gaps.push({ startMs: atMs, endMs: toMs });
  return gaps;
}

function distance(gap: Span, ms: number) {
  if (ms < gap.startMs) return gap.startMs - ms;
  return ms > gap.endMs ? ms - gap.endMs : 0;
}

function snap(ms: number): number {
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

/** Kinds with blocks, plus `alsoShown` lanes that have something else to show. */
export function laneKinds(
  regions: Region[],
  alsoShown: RegionKind[] = [],
): RegionKind[] {
  return ALL_KINDS.filter(
    (kind) => alsoShown.includes(kind) || sameKind(regions, kind).length > 0,
  );
}

export function regionAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): Region | undefined {
  return regions.find((region) => region.kind === kind && covers(region, ms));
}

export function changeRegion(
  regions: Region[],
  id: number,
  change: Partial<Pick<Region, "amount" | "center" | "box" | "settings">>,
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

export function settleSuggestion(
  regions: Region[],
  id: number,
  isKept: boolean,
): Region[] {
  if (!isKept) return removeRegions(regions, [id]);
  return regions.map((region) =>
    region.id === id ? { ...region, isSuggested: undefined } : region,
  );
}

export function settleAll(regions: Region[], isKept: boolean): Region[] {
  if (!isKept) return regions.filter(({ isSuggested }) => !isSuggested);
  return regions.map((region) =>
    region.isSuggested ? { ...region, isSuggested: undefined } : region,
  );
}

export function amountAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): number {
  return regionAt(regions, kind, ms)?.amount ?? 1;
}

export function regionKindForKey(key: string): RegionKind | undefined {
  return ALL_KINDS.find(
    (kind) => REGIONS[kind].key.toLowerCase() === key.toLowerCase(),
  );
}

export function outputAt(regions: Region[], sourceMs: number): number {
  return sameKind(regions, "speed").reduce(
    (ms, { startMs, endMs, amount }) =>
      ms - (clamp(sourceMs, startMs, endMs) - startMs) * (1 - 1 / amount),
    sourceMs,
  );
}

const speedStarts = new WeakMap<Region[], number[]>();

export function sourceAt(regions: Region[], outputMs: number): number {
  const speeds = sameKind(regions, "speed");
  const starts =
    speedStarts.get(regions) ??
    speeds.map(({ startMs }) => outputAt(regions, startMs));
  speedStarts.set(regions, starts);
  return speeds.reduce((ms, { startMs, endMs, amount }, index) => {
    const playedMs = outputMs - starts[index];
    return ms + clamp(playedMs, 0, (endMs - startMs) / amount) * (amount - 1);
  }, outputMs);
}

export function covers(span: Span, ms: number): boolean {
  return ms >= span.startMs && ms < span.endMs;
}

export function regionsAt(regions: Region[], ms: number): Region[] {
  return laneKinds(regions).flatMap(
    (kind) => regionAt(regions, kind, ms) ?? [],
  );
}
