import { type Point, type Rect, clamp } from "@/lib/geometry";
import type { MarkColor } from "./appearance";

export type RegionKind =
  | "zoom"
  | "speed"
  | "captions"
  | "annotation"
  | "blur"
  | "highlight"
  | "titleCard";

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

type TypeStatus = "ready" | "soon";

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
      onlyWith?: string;
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
    hue: string;
    amount: number;
    lengthMs: number;
    settings: Setting[];
    shows: (value: Value) => string;
    status: TypeStatus;
  }
> = {
  zoom: {
    status: "ready",
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
      },
      { kind: "focus" },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  speed: {
    status: "ready",
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
        kind: "hint",
        text: ({ startMs, endMs, amount }) =>
          `Plays ${seconds(endMs - startMs)} s of recording in ${seconds((endMs - startMs) / amount)} s.`,
      },
    ],
    shows: (value) => `${value("amount")}×`,
  },
  captions: comingSoon("Captions", "X", "167 139 250"),
  annotation: comingSoon("Annotation", "N", "244 114 182"),
  blur: {
    status: "ready",
    label: "Blur",
    key: "B",
    hue: "34 211 238",
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
  highlight: comingSoon("Highlight", "H", "250 204 21"),
  titleCard: comingSoon("Title card", "T", "251 113 133"),
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

function comingSoon(label: string, key: string, hue: string) {
  return {
    status: "soon" as const,
    label,
    key,
    hue,
    amount: 0,
    lengthMs: 2000,
    settings: [],
    shows: () => "",
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
    case "color":
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

export const KINDS = ALL_KINDS.filter(
  (kind) => REGIONS[kind].status !== "soon",
);

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
  minMs = MIN_REGION_MS,
): Region[] {
  const dragged = regions.filter((region) => ids.includes(region.id));
  if (dragged.length === 0) return regions;
  const shift =
    drag === "move" ? movedBy(regions, dragged, deltaMs, durationMs) : 0;
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
            snap,
          );
    return span.startMs !== region.startMs || span.endMs !== region.endMs
      ? { ...region, ...span }
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
): number {
  const first = Math.min(...group.map(({ startMs }) => startMs));
  const last = Math.max(...group.map(({ endMs }) => endMs));
  const wanted = snap(first + deltaMs) - first;
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

export function sameKind(regions: Region[], kind: RegionKind): Region[] {
  return regions
    .filter((region) => region.kind === kind)
    .sort((a, b) => a.startMs - b.startMs);
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

export function laneKinds(regions: Region[]): RegionKind[] {
  return ALL_KINDS.filter((kind) => sameKind(regions, kind).length > 0);
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

export const SUGGESTIONS: Partial<
  Record<RegionKind, { label: string; question: string }>
> = {
  zoom: { label: "Auto zoom", question: "Zoom in on these clicks?" },
  speed: { label: "Typing", question: "Speed up this typing?" },
};

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

export function removeRegionAt(regions: Region[], ms: number): Region[] {
  return regions.filter((region) => !covers(region, ms));
}

export function amountAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): number {
  return regionAt(regions, kind, ms)?.amount ?? 1;
}

export function regionKindForKey(key: string): RegionKind | undefined {
  return KINDS.find(
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

export function sourceAt(regions: Region[], outputMs: number): number {
  return sameKind(regions, "speed").reduce((ms, { startMs, endMs, amount }) => {
    const playedMs = outputMs - outputAt(regions, startMs);
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

export function touchingSides(regions: Region[], region: Region) {
  const others = sameKind(regions, region.kind).filter(
    (other) => other !== region,
  );
  return {
    start: others.some(({ endMs }) => endMs === region.startMs),
    end: others.some(({ startMs }) => startMs === region.endMs),
  };
}
