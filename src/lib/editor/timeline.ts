import { twoDigits } from "@/lib/time";
import { clamp } from "@/lib/geometry";
import { badgeCaps } from "./keys";
import {
  ALL_KINDS,
  blockValue,
  KEYCAPS_KIND,
  type Region,
  type RegionDrag,
  type RegionKind,
  sameKind,
  snapEdges,
  spanOf,
} from "./regions";

export function percentAt(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return clamp(ms / durationMs, 0, 1) * 100;
}

export function msAtX(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

const MIN_VIEW_MS = 5000;
const FOLLOW_EDGE_PX = 40;

export function maxZoom(lengthMs: number): number {
  return Math.max(1, lengthMs / MIN_VIEW_MS);
}

export function zoomAround(
  zoom: number,
  factor: number,
  anchorPx: number,
  scrollPx: number,
  lengthMs: number,
) {
  const next = clamp(zoom * factor, 1, maxZoom(lengthMs));
  return {
    zoom: next,
    scrollPx: Math.max(0, ((scrollPx + anchorPx) * next) / zoom - anchorPx),
  };
}

/** Scrolls only when `px` is out of view, bringing it in near the left edge. */
export function revealScroll(
  px: number,
  scrollPx: number,
  viewportPx: number,
): number {
  const isShown =
    px >= scrollPx && px <= scrollPx + viewportPx - FOLLOW_EDGE_PX;
  return isShown ? scrollPx : Math.max(0, px - FOLLOW_EDGE_PX);
}

/** While playing, the playhead walks to the middle, then the tracks scroll under it. */
export function followScroll(
  playheadPx: number,
  scrollPx: number,
  viewportPx: number,
): number {
  const middle = viewportPx / 2;
  const isBeforeMiddle =
    playheadPx >= scrollPx && playheadPx <= scrollPx + middle;
  return isBeforeMiddle ? scrollPx : Math.max(0, playheadPx - middle);
}

const DRAG_SCROLL_PX = 12;

/** A drag near the view's left or right edge scrolls this far a frame, faster nearer the edge. */
export function dragScrollPx(x: number, left: number, right: number): number {
  const into = Math.max(
    left + FOLLOW_EDGE_PX - x,
    x - (right - FOLLOW_EDGE_PX),
  );
  if (into <= 0) return 0;
  const speed = Math.min(1, into / FOLLOW_EDGE_PX) * DRAG_SCROLL_PX;
  return x < (left + right) / 2 ? -speed : speed;
}

export const FRAME_MS = 1000 / 60;
export const STEP_MS = 1000 / 120;

export function frameStep(
  ms: number,
  frames: number,
  durationMs: number,
): number {
  const frame = Math.floor(ms / FRAME_MS) + frames;
  return clamp((frame + 0.5) * FRAME_MS, 0, durationMs);
}

export const GUTTER_PX = 168;
export const TRACKS_TOP_PX = 64;
export const AUDIO_LANE_PX = 24;
export const RULER_PX = 28;
export const TRACK_INSET_PX = 8;

const LANE_PX = 32;
const COLLAPSED_LANE_PX = 20;
const EMPTY_LANES_PX = 64;

export type Lane = {
  kind: RegionKind;
  top: number;
  height: number;
  isCollapsed: boolean;
};

export function laneLayout(kinds: RegionKind[], collapsed: RegionKind[]) {
  let top = 0;
  const lanes = kinds.map((kind): Lane => {
    const isCollapsed = collapsed.includes(kind);
    const lane: Lane = {
      kind,
      top,
      height: isCollapsed ? COLLAPSED_LANE_PX : LANE_PX,
      isCollapsed,
    };
    top += lane.height;
    return lane;
  });
  const heightPx = lanes.length ? top : EMPTY_LANES_PX;
  return { lanes, heightPx };
}

export function laneNeighbors(regions: Region[], region: Region) {
  const others = sameKind(regions, region.kind).filter(
    (other) => other !== region,
  );
  const before = others.filter(({ endMs }) => endMs <= region.startMs);
  const after = others.filter(({ startMs }) => startMs >= region.endMs);
  return {
    beforeMs: Math.max(-Infinity, ...before.map(({ endMs }) => endMs)),
    afterMs: Math.min(Infinity, ...after.map(({ startMs }) => startMs)),
  };
}

export function clipParts(widthPx: number) {
  return { hasIcon: widthPx >= 40, hasLength: widthPx >= 90 };
}

const BLOCK_GAP_PX = 2;
const MARK_MIN_PX = 3;
const MARK_HIT_PX = 12;

/**
 * Where a block draws and where it takes the pointer, in track px. Blocks of a kind always
 * keep a 2 px gap; a block draws at least 3 px wide and is at least 12 px to grab, and two
 * close blocks split the space between them.
 */
export function blockSpan(
  startPx: number,
  endPx: number,
  beforePx: number,
  afterPx: number,
) {
  const fromPx = Math.max(startPx, (beforePx + startPx + BLOCK_GAP_PX) / 2);
  const toPx = Math.min(endPx, (endPx + afterPx - BLOCK_GAP_PX) / 2);
  const middle = (fromPx + toPx) / 2;
  const widthPx = Math.max(MARK_MIN_PX, toPx - fromPx);
  const hitPx = Math.max(MARK_HIT_PX, widthPx) / 2;
  return {
    markFrom: middle - widthPx / 2,
    widthPx,
    hitFrom: Math.max(middle - hitPx, (beforePx + startPx) / 2),
    hitTo: Math.min(middle + hitPx, (endPx + afterPx) / 2),
  };
}

export type BlockTier = "full" | "compact" | "icon" | "bar";
export type MeasureText = (
  text: string,
  font: "name" | "value" | "cap",
) => number;

const ICON_PX = 14;
const CAP_MIN_PX = 16;
const CAP_PAD_PX = 8;
const CAP_GAP_PX = 2;

/** How wide a row of Kbd keycaps draws. */
export function capsWidthPx(caps: string[], measure: MeasureText): number {
  const widths = caps.map((cap) =>
    Math.max(CAP_MIN_PX, measure(cap, "cap") + CAP_PAD_PX),
  );
  return widths.reduce((sum, w) => sum + w, 0) + CAP_GAP_PX * (caps.length - 1);
}

/**
 * The most a block can show whole at its width, never a cut-off part: Full is icon, name and
 * value; Compact is icon and value (for keycaps: the caps alone); Icon; then a bare Bar.
 */
export function blockTier(
  widthPx: number,
  { name, value, caps }: { name: string; value: string; caps?: string[] },
  measure: MeasureText,
): BlockTier {
  if (caps?.length) {
    const capsPx = capsWidthPx(caps, measure);
    if (widthPx >= 8 + ICON_PX + 8 + capsPx + 8) return "full";
    if (widthPx >= 8 + capsPx + 8) return "compact";
  } else {
    const valuePx = value ? 14 + measure(value, "value") : 0;
    if (widthPx >= 11 + ICON_PX + 6 + measure(name, "name") + valuePx + 11)
      return "full";
    if (value && widthPx >= 8 + ICON_PX + 6 + measure(value, "value") + 8)
      return "compact";
  }
  return widthPx >= 24 ? "icon" : "bar";
}

const RUN_GAP_PX = 12;

/**
 * Keycap blocks too narrow to show their caps, under 12 px apart, draw as one run. Only a view:
 * it's worked out from px on every render, so zooming in splits it back into its blocks.
 */
export function keyRuns(
  regions: Region[],
  pxAt: (ms: number) => number,
  measure: MeasureText,
): Region[][] {
  const blocks = sameKind(regions, KEYCAPS_KIND);
  const runs: Region[][] = [];
  let run: Region[] = [];
  blocks.forEach((region, at) => {
    const value = blockValue(region);
    const { widthPx } = blockSpan(
      pxAt(region.startMs),
      pxAt(region.endMs),
      pxAt(blocks[at - 1]?.endMs ?? -Infinity),
      pxAt(blocks[at + 1]?.startMs ?? Infinity),
    );
    const tier = blockTier(
      widthPx,
      { name: "", value, caps: badgeCaps(value) },
      measure,
    );
    const showsCaps = tier === "full" || tier === "compact";
    const last = run[run.length - 1];
    if (
      !showsCaps &&
      last &&
      pxAt(region.startMs) - pxAt(last.endMs) < RUN_GAP_PX
    )
      run.push(region);
    else {
      if (run.length > 1) runs.push(run);
      run = showsCaps ? [] : [region];
    }
  });
  if (run.length > 1) runs.push(run);
  return runs;
}

/** A run shows the keyboard and its count, then the count alone, then a bare bar. */
export function runTier(widthPx: number): "full" | "count" | "bar" {
  return widthPx >= 60 ? "full" : widthPx >= 34 ? "count" : "bar";
}

const MIN_LABEL_GAP_PX = 96;
const DOTS_PER_LABEL = 5;

export function rulerMarks(durationMs: number, widthPx: number) {
  const pxPerSecond = widthPx / Math.max(durationMs / 1000, 0.001);
  const stepS =
    [1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (step) => step * pxPerSecond >= MIN_LABEL_GAP_PX,
    ) ?? 600;
  const dotMs = (stepS * 1000) / DOTS_PER_LABEL;
  const marks: { ms: number; isMajor: boolean }[] = [];
  for (let i = 0; i * dotMs <= durationMs; i++) {
    marks.push({ ms: i * dotMs, isMajor: i % DOTS_PER_LABEL === 0 });
  }
  return marks;
}

export function rulerLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${twoDigits(totalSeconds % 60)}`;
}

const CHAR_PX = 7;
const LABEL_GAP_PX = 6;
const CHIP_HALF_PX = 25;
const AXIS_ROOM_PX = 8;

const CHIP_MARGIN_PX = 26;

/** Ruler labels, each marked crowded by the one before it or under a time chip (`chipsPx`). */
export function rulerLabels(
  durationMs: number,
  widthPx: number,
  chipsPx: number[] = [],
) {
  const chips = chipsPx.map((x) => x + chipShift(x, widthPx));
  const reach = CHIP_HALF_PX + CHIP_MARGIN_PX;
  let shownEnd = -Infinity;
  return rulerMarks(durationMs, widthPx)
    .filter(({ isMajor }) => isMajor)
    .map(({ ms }) => {
      const x = (percentAt(ms, durationMs) / 100) * widthPx;
      const text = rulerLabel(ms);
      const textPx = CHAR_PX * text.length;
      const from = Math.max(0, Math.min(x - textPx / 2, widthPx - textPx));
      const isCrowded = from < shownEnd + LABEL_GAP_PX;
      if (!isCrowded) shownEnd = from + textPx;
      const to = from + textPx;
      const isUnderChip = chips.some(
        (chip) => from < chip + reach && to > chip - reach,
      );
      return { ms, text, from, to, isCrowded, isUnderChip };
    });
}

export function chipShift(x: number, widthPx: number): number {
  const first = CHIP_HALF_PX - AXIS_ROOM_PX;
  const last = widthPx + AXIS_ROOM_PX - CHIP_HALF_PX;
  return Math.max(first, Math.min(x, last)) - x;
}

const SKIM_CHIP_ROOM_PX = 64;

/** The skim marker's chip hides when it would draw within 64 px of the playhead's. */
export function isSkimChipShown(
  skimPx: number,
  playheadPx: number,
  widthPx: number,
): boolean {
  const skimChip = skimPx + chipShift(skimPx, widthPx);
  const playheadChip = playheadPx + chipShift(playheadPx, widthPx);
  return Math.abs(skimChip - playheadChip) >= SKIM_CHIP_ROOM_PX;
}

/** Where Tab, ↑ or ↓ goes from a block or a run (`from`): the next block, or the run it's in. */
export function nextBlock(
  regions: Region[],
  lanes: Lane[],
  runs: Region[][],
  from: Region[],
  step: "next" | "previous" | "up" | "down",
): Region[] | undefined {
  const asStop = (region: Region | undefined) =>
    region && (runs.find((run) => run.includes(region)) ?? [region]);
  if (step === "next" || step === "previous") {
    const order = blockOrder(regions);
    return step === "next"
      ? asStop(order[order.indexOf(from[from.length - 1]) + 1])
      : asStop(order[order.indexOf(from[0]) - 1]);
  }
  const [first] = from;
  const at = lanes.findIndex(({ kind }) => kind === first.kind);
  const lane = lanes[at + (step === "down" ? 1 : -1)];
  if (!lane) return undefined;
  return asStop(
    [...sameKind(regions, lane.kind)].sort(
      (a, b) =>
        Math.abs(a.startMs - first.startMs) -
        Math.abs(b.startMs - first.startMs),
    )[0],
  );
}

export function blockOrder(regions: Region[]): Region[] {
  return [...regions].sort(
    (a, b) =>
      a.startMs - b.startMs ||
      ALL_KINDS.indexOf(a.kind) - ALL_KINDS.indexOf(b.kind),
  );
}

export function lengthLabel(ms: number): string {
  return Math.round(ms / 100) < 600
    ? `${(ms / 1000).toFixed(1)} s`
    : rulerLabel(ms);
}

export function timeLabel(ms: number): string {
  const tenths = Math.round(ms / 100);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${twoDigits(seconds % 60)}.${tenths % 10}`;
}

export function parseTimeLabel(text: string): number {
  const [minutes, seconds] = text.includes(":")
    ? text.split(":").map(Number.parseFloat)
    : [0, Number.parseFloat(text)];
  return (minutes * 60 + seconds) * 1000;
}

/** Where a dragged edge sits on the playhead, a clip edge (`edgesMs`) or another block's edge. */
export function snapGuide(
  regions: Region[],
  ids: number[],
  drag: RegionDrag,
  edgesMs: number[],
): number | undefined {
  const dragged = regions.filter(({ id }) => ids.includes(id));
  if (dragged.length === 0) return undefined;
  const group = spanOf(dragged);
  const moving = {
    move: [group.startMs, group.endMs],
    start: dragged.map(({ startMs }) => startMs),
    end: dragged.map(({ endMs }) => endMs),
  }[drag];
  const others = snapEdges(regions, ids, edgesMs);
  // Kept and recording time convert back and forth, so edges can be a hair apart.
  return moving.find((ms) => others.some((edge) => Math.abs(edge - ms) < 0.5));
}

/**
 * The selection after a click on `ids` (a block or a run): ⌘ or ⇧ adds them, or takes them out
 * when they're all in; a plain click keeps a selection they're all in, so it drags together.
 */
export function pickedIds(
  selectedIds: number[],
  ids: number[],
  isToggling: boolean,
): number[] {
  const isIn = ids.every((id) => selectedIds.includes(id));
  if (!isToggling) return isIn ? selectedIds : ids;
  const others = selectedIds.filter((id) => !ids.includes(id));
  return isIn ? others : [...others, ...ids];
}

/** The run whose blocks are exactly the selection, if one is. */
export function selectedRun(runs: Region[][], selectedIds: number[]) {
  return runs.find(
    (run) =>
      run.length === selectedIds.length &&
      run.every(({ id }) => selectedIds.includes(id)),
  );
}

/**
 * What a drag shows: dashed outlines where moved blocks started (`origins`), a guide at the edge
 * it caught, and over the ruler the new start or, resizing, the new length, centered at `atMs`.
 */
export function dragMarks(
  regions: Region[],
  origins: Region[],
  ids: number[],
  id: number,
  drag: RegionDrag,
  edgesMs: number[],
) {
  const dragged = regions.filter((region) => ids.includes(region.id));
  const held = dragged.find((region) => region.id === id);
  if (!held) return undefined;
  const group = spanOf(dragged);
  const shown = drag === "move" ? group : held;
  return {
    origins: origins.filter(
      (origin) =>
        drag === "move" &&
        dragged.some(
          (region) =>
            region.id === origin.id && region.startMs !== origin.startMs,
        ),
    ),
    guideMs: snapGuide(regions, ids, drag, edgesMs),
    atMs: (shown.startMs + shown.endMs) / 2,
    label:
      drag === "move"
        ? timeLabel(group.startMs)
        : lengthLabel(held.endMs - held.startMs),
  };
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

export function regionsInBox(
  regions: Region[],
  box: Box,
  width: number,
  durationMs: number,
  lanes: Lane[],
  /** The selection a ⇧-box adds to. */
  keptIds: number[],
): number[] {
  const startMs = msAtX(Math.min(box.x0, box.x1), width, durationMs);
  const endMs = msAtX(Math.max(box.x0, box.x1), width, durationMs);
  const minY = Math.min(box.y0, box.y1);
  const maxY = Math.max(box.y0, box.y1);
  const touched = lanes
    .filter(({ top, height }) => top < maxY && top + height > minY)
    .map(({ kind }) => kind);
  const inBox = regions
    .filter(
      ({ startMs: start, endMs: end, kind }) =>
        start < endMs && end > startMs && touched.includes(kind),
    )
    .map(({ id }) => id);
  return [...new Set([...keptIds, ...inBox])];
}
