import { describe, expect, test } from "bun:test";
import {
  frameStep,
  msAtX,
  percentAt,
  rulerLabel,
  rulerMarks,
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
