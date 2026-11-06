import { describe, expect, test } from "bun:test";
import type { Region } from "./regions";
import {
  blockFit,
  laneNeighbors,
  markSpan,
  blockOrder,
  chipShift,
  nextBlock,
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

test.each([
  [160, "full"],
  [159, "compact"],
  [72, "compact"],
  [71, "icon"],
  [24, "icon"],
  [23, "mark"],
  [0.5, "mark"],
] as const)("a %ppx block of any kind is %p", (width, fit) => {
  expect(blockFit(width)).toBe(fit);
});

test("a mark is at least 3 px wide and 12 px to hit, and two close marks split the space between them", () => {
  expect(markSpan(100, 101, -Infinity, Infinity)).toEqual({
    from: 94.5,
    to: 106.5,
    markFrom: 99,
    widthPx: 3,
  });
  expect(markSpan(100, 120, -Infinity, Infinity)).toMatchObject({
    from: 100,
    to: 120,
    widthPx: 20,
  });
  const near = markSpan(100, 101, 96, 104);
  expect([near.from, near.to]).toEqual([98, 102.5]);
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

test("the stretch tip reads 4.0s, ends 0:09.0", () => {
  expect(lengthLabel(4000)).toBe("4.0s");
  expect(lengthLabel(59_940)).toBe("59.9s");
  expect(lengthLabel(59_960)).toBe("1:00");
  expect(lengthLabel(867_400)).toBe("14:27");
  expect(timeLabel(9000)).toBe("0:09.0");
  expect(timeLabel(65_450)).toBe("1:05.5");
  expect(parseTimeLabel("1:05.5")).toBe(65_500);
  expect(parseTimeLabel("4.2")).toBe(4200);
  expect(parseTimeLabel("soon")).toBeNaN();
});

test("regionsInBox picks the modifiers a box touches, by time and lane", () => {
  const regions = [
    { id: 1, kind: "zoom" as const, startMs: 0, endMs: 2000, amount: 1.5 },
    { id: 2, kind: "speed" as const, startMs: 1000, endMs: 3000, amount: 2 },
    { id: 3, kind: "zoom" as const, startMs: 6000, endMs: 8000, amount: 1.5 },
  ];
  const box = { x0: 150, y0: 10, x1: 250, y1: 40 };
  const { lanes } = laneLayout(["zoom", "speed"], []);
  expect(regionsInBox(regions, box, 1000, 10_000, lanes)).toEqual([1, 2]);
  expect(
    regionsInBox(regions, { ...box, y1: 20 }, 1000, 10_000, lanes),
  ).toEqual([1]);
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
    expect(nextBlock(regions, lanes, regions[1], "next")?.id).toBe(1);
    expect(nextBlock(regions, lanes, regions[2], "previous")).toBeUndefined();
    expect(nextBlock(regions, lanes, regions[0], "down")?.id).toBe(4);
    expect(nextBlock(regions, lanes, regions[3], "up")?.id).toBe(1);
    expect(nextBlock(regions, lanes, regions[0], "up")).toBeUndefined();
  });
});

test("the playhead chip centers on the line, but slides inward at either end of the track", () => {
  expect(chipShift(500, 1000)).toBe(0);
  expect(chipShift(0, 1000)).toBe(22);
  expect(chipShift(1000, 1000)).toBe(-22);
  expect(chipShift(0, 0)).toBe(22);
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

test("while playing, the timeline turns the page when the playhead reaches the edge", () => {
  expect(followScroll(500, 0, 1000)).toBe(0);
  expect(followScroll(990, 0, 1000)).toBe(950);
  expect(followScroll(100, 400, 1000)).toBe(60);
  expect(followScroll(20, 0, 1000)).toBe(0);
});
