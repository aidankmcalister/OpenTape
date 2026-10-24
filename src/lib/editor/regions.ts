import { type Point, clamp } from "@/lib/geometry";

export type RegionKind = "zoom" | "speed";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  amount: number;
  center?: Point;
};

export const REGIONS: Record<
  RegionKind,
  { label: string; hint: string; key: string; amount: number }
> = {
  zoom: { label: "Zoom", hint: "Zoom in on an area", key: "Z", amount: 1.5 },
  speed: { label: "Speed", hint: "Speed up or slow down", key: "S", amount: 2 },
};

export const MIN_REGION_MS = 250;

export type RegionDrag = "move" | "start" | "end";

export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
): Region[] {
  if (regions.some((region) => covers(region, atMs))) return regions;
  const nextStart = Math.min(
    ...regions
      .filter((region) => region.startMs > atMs)
      .map((region) => region.startMs),
    durationMs,
  );
  const endMs = Math.min(atMs + 2000, nextStart);
  if (endMs - atMs < MIN_REGION_MS) return regions;
  const id = Math.max(0, ...regions.map((region) => region.id)) + 1;
  const added = {
    id,
    kind,
    startMs: atMs,
    endMs,
    amount: REGIONS[kind].amount,
  };
  return [...regions, added].sort((a, b) => a.startMs - b.startMs);
}

export function dragRegion<T extends Pick<Region, "id" | "startMs" | "endMs">>(
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
  change: Partial<Pick<Region, "amount" | "center">>,
): Region[] {
  const region = regions.find((region) => region.id === id);
  if (!region) return regions;
  const changed = { ...region, ...change };
  return JSON.stringify(changed) === JSON.stringify(region)
    ? regions
    : regions.map((other) => (other === region ? changed : other));
}

export function removeRegion(regions: Region[], id: number): Region[] {
  return regions.some((region) => region.id === id)
    ? regions.filter((region) => region.id !== id)
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
  const region = regions.find(
    (region) => region.kind === kind && covers(region, ms),
  );
  return region?.amount ?? 1;
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
  return regions.filter(({ kind }) => kind === "speed");
}
