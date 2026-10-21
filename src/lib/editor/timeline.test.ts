import { describe, expect, test } from "bun:test";
import { msAtX, percentAt } from "./timeline";

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
});
