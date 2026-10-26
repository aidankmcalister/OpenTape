import { describe, expect, test } from "bun:test";
import type { Region } from "./regions";
import {
  blockContent,
  suggestionContent,
  blockOrder,
  chipFrom,
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

  test("at 64px a second, a 15 second clip gets a label every 2 seconds and a short tick between", () => {
    expect(labeled(15_000, 960)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000,
    ]);
    expect(rulerMarks(15_000, 960)[1]).toEqual({ ms: 1000, isMajor: false });
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
  [140, "full"],
  [112, "full"],
  [111, "value"],
  [74, "value"],
  [73, "icon"],
] as const)("a %ppx Zoom 1.5× block shows %p", (width, content) => {
  expect(blockContent(width, "Zoom", "1.5×")).toBe(content);
});

test("the stretch tip reads 4.0s, ends 0:09.0", () => {
  expect(lengthLabel(4000)).toBe("4.0s");
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
  test("labels sit right of their tick, the last one flips left, and none overlap", () => {
    const labels = rulerLabels(8400, 600);
    expect(labels[0]).toMatchObject({ ms: 0, from: 6, flips: false });
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
    expect(shown).toEqual(["0:00", "20:00", "40:00"]);
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
  expect(chipFrom(500, 1000)).toBe(470);
  expect(chipFrom(0, 1000)).toBe(-8);
  expect(chipFrom(1000, 1000)).toBe(948);
  expect(chipFrom(0, 0)).toBe(-8);
});

test.each([
  [200, "full"],
  [90, "buttons"],
  [50, "icon"],
] as const)(
  "a %ppx suggestion shows %p: the name goes first, then the buttons, and the icon stays",
  (width, fit) => {
    expect(suggestionContent(width, "Auto zoom")).toBe(fit);
  },
);
