import { describe, expect, test } from "bun:test";
import {
  clampAmount,
  DEFAULT_APPEARANCE,
  fillCss,
  fillGradient,
  frameLayout,
} from "./appearance";

describe("appearance", () => {
  test("fillCss draws a gradient corner to corner, and a color as its middle stop", () => {
    expect(fillCss({ kind: "gradient", preset: 0 })).toBe(
      "linear-gradient(135deg, #0f4c5c 0%, #2a9d8f 55%, #e9c46a 100%)",
    );
    expect(fillCss({ kind: "color", preset: 2 })).toBe("#3b82f6");
  });

  test.each([
    ["padding", 200, 160],
    ["radius", -3, 0],
    ["shadowBlur", 47.6, 48],
  ] as const)(
    "clampAmount(%p, %p) keeps it in range, in whole steps",
    (amount, value, clamped) => {
      expect(clampAmount(amount, value)).toBe(clamped);
    },
  );

  test("frameLayout fits the frame inside the margin and scales the padding", () => {
    const { frame, recording, scale } = frameLayout(
      { ...DEFAULT_APPEARANCE, padding: 192 },
      { width: 1056, height: 1000 },
      16 / 9,
    );
    expect(frame).toEqual({ width: 960, height: 540 });
    expect(scale).toBe(0.5);
    expect(recording.width).toBeCloseTo(618.67, 2);
    expect(recording.height).toBeCloseTo(348, 5);
  });

  test("frameLayout collapses to nothing on a canvas smaller than its margin", () => {
    const { frame, recording } = frameLayout(
      DEFAULT_APPEARANCE,
      { width: 40, height: 40 },
      1,
    );
    expect(frame).toEqual({ width: 0, height: 0 });
    expect(recording).toEqual({ width: 0, height: 0 });
  });

  test("fillGradient makes a color a gradient that doesn't change", () => {
    expect(fillGradient({ kind: "color", preset: 2 }).stops).toEqual([
      { color: "#3b82f6", at: 0 },
      { color: "#3b82f6", at: 1 },
    ]);
  });
});
