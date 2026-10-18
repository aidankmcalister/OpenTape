/** Zoom and speed regions laid over the recording, and the ruler above them. */

export type RegionKind = "zoom" | "speed";

export type Region = {
  id: number;
  kind: RegionKind;
  startMs: number;
  endMs: number;
  /** How far a zoom zooms in, or how fast a speed region plays. */
  amount: number;
};

export const REGIONS: Record<
  RegionKind,
  { label: string; hint: string; key: string; amount: number }
> = {
  zoom: { label: "Zoom", hint: "Zoom in on an area", key: "Z", amount: 1.5 },
  speed: { label: "Speed", hint: "Speed up or slow down", key: "S", amount: 2 },
};

const REGION_MS = 2000;
/** Shorter than this, a region is too small to see or grab. */
const SHORTEST_REGION_MS = 250;

/**
 * Adds a region starting at the playhead. It runs up to two seconds, stopping early at the next
 * region or the end. Nothing is added when the playhead is inside a region or there's no room.
 */
export function addRegion(
  regions: Region[],
  kind: RegionKind,
  atMs: number,
  durationMs: number,
): Region[] {
  if (regions.some((region) => atMs >= region.startMs && atMs < region.endMs)) {
    return regions;
  }
  const nextStart = Math.min(
    ...regions
      .filter((region) => region.startMs > atMs)
      .map((region) => region.startMs),
    durationMs,
  );
  const endMs = Math.min(atMs + REGION_MS, nextStart);
  if (endMs - atMs < SHORTEST_REGION_MS) return regions;
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

/** The zoom or speed at `ms`: the region's amount there, or 1 outside every region. */
export function amountAt(
  regions: Region[],
  kind: RegionKind,
  ms: number,
): number {
  const region = regions.find(
    (region) =>
      region.kind === kind && ms >= region.startMs && ms < region.endMs,
  );
  return region?.amount ?? 1;
}

type Mark = { ms: number; isMajor: boolean };

const LABEL_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MOST_LABELS = 10;

/** Labelled marks at a round step that fits about ten labels, with a short mark between each. */
export function rulerMarks(durationMs: number): Mark[] {
  const durationS = durationMs / 1000;
  const stepS =
    LABEL_STEPS_S.find((step) => durationS / step <= MOST_LABELS) ??
    LABEL_STEPS_S[LABEL_STEPS_S.length - 1];
  const halfStepMs = (stepS * 1000) / 2;
  const marks: Mark[] = [];
  for (let i = 0; i * halfStepMs <= durationMs; i++) {
    marks.push({ ms: i * halfStepMs, isMajor: i % 2 === 0 });
  }
  return marks;
}

/** "0:04" on the ruler. */
export function rulerLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, "0")}`;
}
