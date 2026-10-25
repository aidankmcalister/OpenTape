import { type Point, clamp } from "@/lib/geometry";
import type { MarkColor } from "./appearance";

export type RegionKind =
  | "zoom"
  | "speed"
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

export type TypeStatus = "ready" | "experimental" | "soon";

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
  | { kind: "focus" }
  | { kind: "hint"; text: string | ((region: Region) => string) };

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
        disabled: ["Follow cursor"],
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
  clickRing: {
    status: "experimental",
    label: "Click ring",
    key: "P",
    hue: "148 163 184",
    amount: 0,
    lengthMs: 1000,
    settings: [
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
    shows: (value) => String(value("style")),
  },
  captions: comingSoon("Captions", "C", "167 139 250"),
  annotation: comingSoon("Annotation", "N", "244 114 182"),
  blur: comingSoon("Blur", "B", "34 211 238"),
  highlight: comingSoon("Highlight", "H", "250 204 21"),
  titleCard: comingSoon("Title card", "T", "251 113 133"),
};

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

function initialOf(setting: Setting): SettingValue {
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

export const STATUSES: { status: TypeStatus; label: string }[] = [
  { status: "ready", label: "Modifiers" },
  { status: "experimental", label: "Experimental" },
  { status: "soon", label: "Coming soon" },
];

export const MIN_REGION_MS = 200;

const SNAP_MS = 100;

export type RegionDrag = "move" | "start" | "end";

export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
): Region[] {
  const [gap] = freeGaps(sameKind(regions, kind), durationMs)
    .filter(({ startMs, endMs }) => endMs - startMs >= MIN_REGION_MS)
    .sort(
      (a, b) => distance(a, atMs) - distance(b, atMs) || b.startMs - a.startMs,
    );
  if (!gap) return regions;
  const startMs = clamp(atMs, gap.startMs, gap.endMs - MIN_REGION_MS);
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
        : stretched(regions, region, drag, deltaMs, durationMs, minMs);
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

function stretched(
  regions: Region[],
  region: Region,
  edge: "start" | "end",
  deltaMs: number,
  durationMs: number,
  minMs: number,
) {
  const { startMs, endMs } = region;
  const others = sameKind(regions, region.kind).filter(
    (other) => other !== region,
  );
  if (edge === "start") {
    const floor = Math.max(
      0,
      ...others.filter((o) => o.endMs <= startMs).map((o) => o.endMs),
    );
    return {
      startMs: clamp(snap(startMs + deltaMs), floor, endMs - minMs),
      endMs,
    };
  }
  const ceiling = Math.min(
    durationMs,
    ...others.filter((o) => o.startMs >= endMs).map((o) => o.startMs),
  );
  return {
    startMs,
    endMs: clamp(snap(endMs + deltaMs), startMs + minMs, ceiling),
  };
}

function sameKind(regions: Region[], kind: RegionKind): Region[] {
  return regions.filter((region) => region.kind === kind);
}

function freeGaps(lane: Region[], durationMs: number) {
  const gaps: { startMs: number; endMs: number }[] = [];
  let atMs = 0;
  for (const region of [...lane].sort((a, b) => a.startMs - b.startMs)) {
    if (region.startMs > atMs)
      gaps.push({ startMs: atMs, endMs: region.startMs });
    atMs = Math.max(atMs, region.endMs);
  }
  if (atMs < durationMs) gaps.push({ startMs: atMs, endMs: durationMs });
  return gaps;
}

function distance(gap: { startMs: number; endMs: number }, ms: number) {
  if (ms < gap.startMs) return gap.startMs - ms;
  return ms > gap.endMs ? ms - gap.endMs : 0;
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
