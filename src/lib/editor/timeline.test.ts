import { describe, expect, test } from "bun:test";
import type { Region } from "./regions";
import {
  laneNeighbors,
  keyRuns,
  runTier,
  blockSpan,
  blockTier,
  clipParts,
  capsWidthPx,
  blockOrder,
  chipShift,
  isSkimChipShown,
  nextBlock,
  pickedIds,
  selectedRun,
  dragMarks,
  rulerLabels,
  frameStep,
  lengthLabel,
  msAtX,
  percentAt,
  laneLayout,
  regionsInBox,
  rulerLabel,
  rulerMarks,
  parseTimeLabel,
  timeLabel,
  followScroll,
  maxZoom,
  revealScroll,
  snapGuide,
  dragScrollPx,
  zoomAround,
} from "./timeline";

describe("timeline", () => {
  test.each([
    [0, 10_000, 0],
    [2_500, 10_000, 25],
    [10_000, 10_000, 100],
    [12_000, 10_000, 100],
    [-500, 10_000, 0],
    [500, 0, 0],
  ])("percentAt(%p, %p) is %p", (ms, durationMs, percent) => {
    expect(percentAt(ms, durationMs)).toBe(percent);
  });

  test.each([
    [0, 200, 10_000, 0],
    [50, 200, 10_000, 2_500],
    [200, 200, 10_000, 10_000],
    [250, 200, 10_000, 10_000],
    [-20, 200, 10_000, 0],
    [50, 0, 10_000, 0],
  ])("msAtX(%p, %p, %p) is %p", (x, width, durationMs, ms) => {
    expect(msAtX(x, width, durationMs)).toBe(ms);
  });

  test.each([
    ["forward from the start", 0, 1, 25],
    ["forward from mid-frame", 25, 1, 41.667],
    ["back a frame", 41.667, -1, 25],
    ["back past the start", 0, -1, 0],
    ["forward past the end", 9_995, 1, 10_000],
  ])("frameStep: %s", (_, ms, frames, expected) => {
    expect(frameStep(ms, frames, 10_000)).toBeCloseTo(expected, 2);
  });
});

describe("ruler", () => {
  const labeled = (durationMs: number, widthPx: number) =>
    rulerMarks(durationMs, widthPx)
      .filter((mark) => mark.isMajor)
      .map((mark) => mark.ms);

  test("at 64px a second, a 15 second clip gets a label every 2 seconds and four dots between", () => {
    expect(labeled(15_000, 960)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000,
    ]);
    expect(rulerMarks(15_000, 960)[1]).toEqual({ ms: 400, isMajor: false });
  });

  test("with room to spare, labels come every second, end included", () => {
    expect(labeled(10_000, 1200)).toHaveLength(11);
    const marks = rulerMarks(10_000, 1200);
    expect(marks[marks.length - 1]).toEqual({ ms: 10_000, isMajor: true });
  });

  test("rulerMarks gives a single mark for an empty clip", () => {
    expect(rulerMarks(0, 800)).toEqual([{ ms: 0, isMajor: true }]);
  });

  test("rulerMarks falls back to ten-minute labels for very long clips", () => {
    const [first, second] = labeled(3 * 60 * 60 * 1000, 800);
    expect(second - first).toBe(600_000);
  });

  test.each([
    [4000, "0:04"],
    [75_000, "1:15"],
    [1400, "0:01"],
    [59_600, "1:00"],
  ])("rulerLabel(%p) rounds to the nearest second: %p", (ms, label) => {
    expect(rulerLabel(ms)).toBe(label);
  });
});

test("lanes are 32px, 20px collapsed, and 64px when empty", () => {
  const { lanes, heightPx } = laneLayout(["zoom", "speed", "blur"], ["speed"]);
  expect(lanes.map(({ top, height }) => [top, height])).toEqual([
    [0, 32],
    [32, 20],
    [52, 32],
  ]);
  expect(heightPx).toBe(84);
  expect(laneLayout(["zoom", "speed", "blur"], []).heightPx).toBe(96);
  expect(laneLayout([], []).heightPx).toBe(64);
});

test("a block keeps a 2 px gap to a neighbor, draws at least 3 px and is 12 px to hit", () => {
  expect(blockSpan(100, 101, -Infinity, Infinity)).toEqual({
    markFrom: 99,
    widthPx: 3,
    hitFrom: 94.5,
    hitTo: 106.5,
  });
  const touching = blockSpan(100, 140, 60, 140);
  expect([touching.markFrom, touching.widthPx]).toEqual([100, 39]);
  expect(blockSpan(140, 180, 140, Infinity).markFrom).toBe(141);
  const near = blockSpan(100, 101, 96, 104);
  expect([near.hitFrom, near.hitTo]).toEqual([98, 102.5]);
});

test("a block shows the most that fits whole: full, compact, icon, then a bare bar", () => {
  const measure = (text: string) => text.length * 7;
  const zoom = { name: "Zoom", value: "2×" };
  expect(blockTier(98, zoom, measure)).toBe("full");
  expect(blockTier(97, zoom, measure)).toBe("compact");
  expect(blockTier(49, zoom, measure)).toBe("icon");
  expect(blockTier(23, zoom, measure)).toBe("bar");
  const keys = { name: "Keystrokes", value: "⌘K", caps: ["⌘", "K"] };
  expect(blockTier(72, keys, measure)).toBe("full");
  expect(blockTier(71, keys, measure)).toBe("compact");
  expect(blockTier(50, keys, measure)).toBe("compact");
  expect(blockTier(49, keys, measure)).toBe("icon");
});

test("a block's neighbors are the nearest blocks of its own kind on either side", () => {
  const region = (
    id: number,
    kind: Region["kind"],
    startMs: number,
    endMs: number,
  ): Region => ({
    id,
    kind,
    startMs,
    endMs,
    amount: 1,
  });
  const middle = region(2, "zoom", 4000, 5000);
  const regions = [
    region(1, "zoom", 0, 1000),
    region(3, "zoom", 2000, 3000),
    middle,
    region(4, "speed", 3500, 3900),
    region(5, "zoom", 8000, 9000),
  ];
  expect(laneNeighbors(regions, middle)).toEqual({
    beforeMs: 3000,
    afterMs: 8000,
  });
  expect(laneNeighbors([middle], middle)).toEqual({
    beforeMs: -Infinity,
    afterMs: Infinity,
  });
});

test("the stretch tip reads 4.0 s, ends 0:09.0", () => {
  expect(lengthLabel(4000)).toBe("4.0 s");
  expect(lengthLabel(59_940)).toBe("59.9 s");
  expect(lengthLabel(59_960)).toBe("1:00");
  expect(lengthLabel(867_400)).toBe("14:27");
  expect(timeLabel(9000)).toBe("0:09.0");
  expect(timeLabel(65_450)).toBe("1:05.5");
  expect(parseTimeLabel("1:05.5")).toBe(65_500);
  expect(parseTimeLabel("4.2")).toBe(4200);
  expect(parseTimeLabel("soon")).toBeNaN();
});

test("regionsInBox picks the modifiers a box touches, by time and lane, added to any it keeps", () => {
  const regions = [
    { id: 1, kind: "zoom" as const, startMs: 0, endMs: 2000, amount: 1.5 },
    { id: 2, kind: "speed" as const, startMs: 1000, endMs: 3000, amount: 2 },
    { id: 3, kind: "zoom" as const, startMs: 6000, endMs: 8000, amount: 1.5 },
  ];
  const box = { x0: 150, y0: 10, x1: 250, y1: 40 };
  const { lanes } = laneLayout(["zoom", "speed"], []);
  expect(regionsInBox(regions, box, 1000, 10_000, lanes, [])).toEqual([1, 2]);
  expect(
    regionsInBox(regions, { ...box, y1: 20 }, 1000, 10_000, lanes, []),
  ).toEqual([1]);
  expect(regionsInBox(regions, box, 1000, 10_000, lanes, [3, 1])).toEqual([
    3, 1, 2,
  ]);
});

describe("ruler labels and block navigation", () => {
  test("labels center on their dot, stay inside the ruler, and none overlap", () => {
    const labels = rulerLabels(8400, 600);
    expect(labels[0]).toMatchObject({ ms: 0, from: 0 });
    const last = labels[labels.length - 1];
    expect(last.to).toBeLessThanOrEqual(600);
    const shown = labels.filter(({ isCrowded }) => !isCrowded);
    shown.slice(1).forEach((label, index) => {
      expect(label.from).toBeGreaterThanOrEqual(shown[index].to);
    });
  });

  test("a crowded label is measured against the last label shown, not a hidden one", () => {
    const shown = rulerLabels(3_600_000, 200)
      .filter(({ isCrowded }) => !isCrowded)
      .map(({ text }) => text);
    expect(shown).toEqual(["0:00", "20:00", "40:00", "60:00"]);
  });

  test("a label within 26 px of a time chip hides, so the chip never sits on text", () => {
    const under = (chipsPx: number[]) =>
      rulerLabels(10_000, 1000, chipsPx)
        .filter(({ isUnderChip }) => isUnderChip)
        .map(({ text }) => text);
    expect(under([])).toEqual([]);
    expect(under([500])).toEqual(["0:05"]);
    expect(under([436])).toEqual(["0:04", "0:05"]);
    expect(under([435])).toEqual(["0:04"]);
    expect(under([0, 1000])).toEqual(["0:00", "0:10"]);
  });

  const zoom = (id: number, startMs: number): Region => ({
    id,
    kind: "zoom",
    startMs,
    endMs: startMs + 500,
    amount: 1.5,
  });
  const speed = (id: number, startMs: number): Region => ({
    ...zoom(id, startMs),
    kind: "speed",
  });
  const regions = [zoom(1, 3000), speed(2, 1000), zoom(3, 0), speed(4, 3200)];
  const lanes = laneLayout(["zoom", "speed"], []).lanes;

  test("blocks go in time order, and by registry order when they start together", () => {
    expect(blockOrder(regions).map(({ id }) => id)).toEqual([3, 2, 1, 4]);
  });

  test("Tab walks that order, and up and down find the nearest block in the next lane", () => {
    const step = (from: Region, to: Parameters<typeof nextBlock>[4]) =>
      nextBlock(regions, lanes, [], [from], to)?.map(({ id }) => id);
    expect(step(regions[1], "next")).toEqual([1]);
    expect(step(regions[2], "previous")).toBeUndefined();
    expect(step(regions[0], "down")).toEqual([4]);
    expect(step(regions[3], "up")).toEqual([1]);
    expect(step(regions[0], "up")).toBeUndefined();
  });

  test("a block inside a run is reached as the run, and Tab leaves a run past its last block", () => {
    const run = [regions[1], regions[0]];
    const step = (from: Region[], to: Parameters<typeof nextBlock>[4]) =>
      nextBlock(regions, lanes, [run], from, to)?.map(({ id }) => id);
    expect(step([regions[2]], "next")).toEqual([2, 1]);
    expect(step(run, "next")).toEqual([4]);
    expect(step(run, "previous")).toEqual([3]);
    expect(step([regions[3]], "previous")).toEqual([2, 1]);
  });
});

test("the 50 px playhead chip centers on the line, but slides inward at either end of the track", () => {
  expect(chipShift(500, 1000)).toBe(0);
  expect(chipShift(0, 1000)).toBe(17);
  expect(chipShift(1000, 1000)).toBe(-17);
  expect(chipShift(0, 0)).toBe(17);
});

test("the skim chip hides within 64 px of the playhead chip, measured where the chips draw", () => {
  expect(isSkimChipShown(564, 500, 1000)).toBe(true);
  expect(isSkimChipShown(563, 500, 1000)).toBe(false);
  expect(isSkimChipShown(436, 500, 1000)).toBe(true);
  expect(isSkimChipShown(70, 0, 1000)).toBe(false);
  expect(isSkimChipShown(81, 0, 1000)).toBe(true);
});

test("the timeline zooms around the pointer, from fitting the view to five seconds across", () => {
  expect(maxZoom(867_000)).toBeCloseTo(173.4);
  expect(maxZoom(3000)).toBe(1);
  expect(zoomAround(1, 2, 250, 0, 60_000)).toEqual({ zoom: 2, scrollPx: 250 });
  expect(zoomAround(2, 0.5, 250, 250, 60_000)).toEqual({
    zoom: 1,
    scrollPx: 0,
  });
  expect(zoomAround(10, 4, 0, 0, 60_000).zoom).toBe(12);
  expect(zoomAround(1, 0.5, 100, 0, 60_000)).toEqual({ zoom: 1, scrollPx: 0 });
});

test("a spot out of view scrolls in near the left edge", () => {
  expect(revealScroll(500, 0, 1000)).toBe(0);
  expect(revealScroll(990, 0, 1000)).toBe(950);
  expect(revealScroll(100, 400, 1000)).toBe(60);
  expect(revealScroll(20, 0, 1000)).toBe(0);
});

test("while playing, the playhead walks to the middle, then the tracks scroll under it", () => {
  expect(followScroll(300, 0, 1000)).toBe(0);
  expect(followScroll(500, 0, 1000)).toBe(0);
  expect(followScroll(501, 0, 1000)).toBe(1);
  expect(followScroll(2000, 1400, 1000)).toBe(1500);
  expect(followScroll(100, 400, 1000)).toBe(0);
});

test("keycaps are at least 16 px each with 2 px between them", () => {
  const measure = (text: string) => text.length * 6;
  expect(capsWidthPx(["⌘", "K"], measure)).toBe(34);
  expect(capsWidthPx(["⌘", "Page Up"], measure)).toBe(16 + 2 + 50);
});

test("keystroke blocks too narrow for their keycaps and under 12 px apart draw as one run", () => {
  const measure = (text: string) => text.length * 6;
  const keys = (id: number, startMs: number, endMs: number): Region => ({
    id,
    kind: "keys",
    startMs,
    endMs,
    amount: 0,
    settings: { text: "⌘Z" },
  });
  const regions = [
    keys(1, 0, 1500),
    keys(2, 1600, 3100),
    keys(3, 3200, 4700),
    keys(4, 6000, 7500),
    keys(5, 10_000, 16_000),
    keys(6, 16_100, 17_600),
  ];
  const ids = (pxPerMs: number) =>
    keyRuns(regions, (ms) => ms * pxPerMs, measure).map((run) =>
      run.map(({ id }) => id),
    );
  // 10 px a second: 1 to 3 crowd together; 4 is 13 px off; 5 shows its caps, so 6 is alone.
  expect(ids(0.01)).toEqual([[1, 2, 3]]);
  // Zoomed in, every block shows its caps and the run splits.
  expect(ids(0.05)).toEqual([]);
});

test("a run shows the keyboard and its count from 60 px, the count alone from 34, else a bar", () => {
  expect(runTier(60)).toBe("full");
  expect(runTier(59)).toBe("count");
  expect(runTier(34)).toBe("count");
  expect(runTier(33)).toBe("bar");
});

test.each([
  [[2030, 4030], "move", [], 4030, "its end on another kind's start"],
  [[2460, 4460], "move", [2460], 2460, "its start on the playhead"],
  [
    [2460, 4460],
    "move",
    [2460.0001],
    2460,
    "a start a hair off after a time conversion",
  ],
  [[2050, 4050], "move", [2460], undefined, "on nothing but the grid"],
  [[1000, 4030], "end", [], 4030, "a resized end on an edge"],
  [[4030, 5000], "end", [], undefined, "only the dragged edge counts"],
] as const)(
  "a block at %p dragged by %p with %p shows a guide at %p: %s",
  ([startMs, endMs], edge, edgesMs, expected) => {
    const regions: Region[] = [
      { id: 1, kind: "zoom", startMs, endMs, amount: 1.5 },
      { id: 2, kind: "speed", startMs: 4030, endMs: 6000, amount: 2 },
    ];
    expect(snapGuide(regions, [1], edge, [...edgesMs])).toBe(expected);
  },
);

test.each([
  [500, 0, "away from the edges"],
  [980, 6, "halfway into the right edge"],
  [1100, 12, "past the right edge, at full speed"],
  [130, -3, "a quarter into the left edge"],
] as const)(
  "dragging at x %p in a 100 to 1000 view scrolls %p px a frame: %s",
  (x, expected) => {
    expect(dragScrollPx(x, 100, 1000)).toBe(expected);
  },
);

test("a clip shows its film icon from 40 px and its length from 90 px", () => {
  expect(clipParts(39)).toEqual({ hasIcon: false, hasLength: false });
  expect(clipParts(40)).toEqual({ hasIcon: true, hasLength: false });
  expect(clipParts(89)).toEqual({ hasIcon: true, hasLength: false });
  expect(clipParts(90)).toEqual({ hasIcon: true, hasLength: true });
});

test("a click picks a block or a run; ⌘ or ⇧ adds it, or takes it out when it's all in", () => {
  expect(pickedIds([1], [2, 3], false)).toEqual([2, 3]);
  // A plain click on what's selected keeps the selection, so it drags together.
  expect(pickedIds([1, 2, 3], [2, 3], false)).toEqual([1, 2, 3]);
  expect(pickedIds([1, 2], [2, 3], true)).toEqual([1, 2, 3]);
  expect(pickedIds([1, 2, 3], [2, 3], true)).toEqual([1]);
});

test("a run is the selection only when the selection is exactly its blocks", () => {
  const keys = (id: number): Region => ({
    id,
    kind: "keys",
    startMs: id * 100,
    endMs: id * 100 + 50,
    amount: 0,
  });
  const runs = [
    [keys(1), keys(2)],
    [keys(3), keys(4)],
  ];
  expect(selectedRun(runs, [4, 3])).toBe(runs[1]);
  expect(selectedRun(runs, [1, 2, 3])).toBeUndefined();
  expect(selectedRun(runs, [1])).toBeUndefined();
});

test("a drag shows where its blocks started, the edge it caught, and its start or length", () => {
  const zoom = (id: number, startMs: number, endMs: number): Region => ({
    id,
    kind: "zoom",
    startMs,
    endMs,
    amount: 1.5,
  });
  const before = [
    zoom(1, 1000, 2000),
    zoom(2, 3000, 4000),
    zoom(3, 6000, 7000),
  ];
  const moved = [zoom(1, 2000, 3000), zoom(2, 4000, 5000), before[2]];
  expect(dragMarks(moved, before, [1, 2], 2, "move", [])).toEqual({
    origins: before.slice(0, 2),
    guideMs: undefined,
    atMs: 3500,
    label: "0:02.0",
  });
  expect(dragMarks(before, before, [1, 2], 2, "move", [])?.origins).toEqual([]);
  const resized = [zoom(1, 1000, 6000), before[2]];
  expect(dragMarks(resized, before, [1], 1, "end", [])).toEqual({
    origins: [],
    guideMs: 6000,
    atMs: 3500,
    label: "5.0 s",
  });
  expect(dragMarks(before, before, [9], 9, "move", [])).toBeUndefined();
});
