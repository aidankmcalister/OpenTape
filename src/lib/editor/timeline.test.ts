import { describe, expect, test } from "bun:test";
import {
  blockContent,
  frameStep,
  lengthLabel,
  modifiersWindowPx,
  msAtX,
  percentAt,
  regionsInBox,
  rowAtY,
  rowLayout,
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
  const labeled = (durationMs: number) =>
    rulerMarks(durationMs)
      .filter((mark) => mark.isMajor)
      .map((mark) => mark.ms);

  test("rulerMarks labels every two seconds of a 15 second clip, with a short mark between", () => {
    expect(labeled(15_000)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000,
    ]);
    expect(rulerMarks(15_000)[1]).toEqual({ ms: 1000, isMajor: false });
  });

  test("rulerMarks labels every second of a ten second clip, end included", () => {
    expect(labeled(10_000)).toHaveLength(11);
    const marks = rulerMarks(10_000);
    expect(marks[marks.length - 1]).toEqual({ ms: 10_000, isMajor: true });
  });

  test("rulerMarks gives a single mark for an empty clip", () => {
    expect(rulerMarks(0)).toEqual([{ ms: 0, isMajor: true }]);
  });

  test("rulerMarks falls back to ten-minute labels for very long clips", () => {
    const [first, second] = labeled(3 * 60 * 60 * 1000);
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

test.each([
  [1, 24, 128],
  [3, 80, 184],
  [4, 108, 184],
  [7, 192, 184],
])(
  "%p rows need %ppx, and a 184px limit makes a %ppx timeline",
  (count, areaPx, timelinePx) => {
    expect(rowLayout(count).areaPx).toBe(areaPx);
    expect(modifiersWindowPx(count, 184) + 104).toBe(timelinePx);
  },
);

test("a 240px limit shows five rows and scrolls past them", () => {
  expect(modifiersWindowPx(5, 240) + 104).toBe(240);
  expect(modifiersWindowPx(6, 240) + 104).toBe(240);
});

test("rowAtY finds the row under the pointer, or the next new one", () => {
  const { rows } = rowLayout(3);
  expect(rowAtY(rows, 10)).toBe(0);
  expect(rowAtY(rows, 40)).toBe(1);
  expect(rowAtY(rows, 200)).toBe(3);
});

test.each([
  [140, "full"],
  [100, "compact"],
  [50, "icon"],
  [40, "bar"],
] as const)("a %ppx Zoom block shows %p", (width, content) => {
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

test("regionsInBox picks the modifiers a box touches, by time and row", () => {
  const regions = [
    {
      id: 1,
      kind: "zoom" as const,
      startMs: 0,
      endMs: 2000,
      amount: 1.5,
      row: 0,
    },
    {
      id: 2,
      kind: "speed" as const,
      startMs: 1000,
      endMs: 3000,
      amount: 2,
      row: 1,
    },
    {
      id: 3,
      kind: "zoom" as const,
      startMs: 6000,
      endMs: 8000,
      amount: 1.5,
      row: 0,
    },
  ];
  const box = { x0: 150, y0: 5, x1: 250, y1: 40 };
  const { rows } = rowLayout(2);
  expect(regionsInBox(regions, box, 1000, 10_000, rows)).toEqual([1, 2]);
  expect(regionsInBox(regions, { ...box, y1: 10 }, 1000, 10_000, rows)).toEqual(
    [1],
  );
});
