import { describe, expect, test } from "bun:test";
import {
  changeStop,
  clampAmount,
  DEFAULT_APPEARANCE,
  fillCss,
  fillGradient,
  frameLayout,
  type Fill,
} from "./appearance";

const fill = (change: Partial<Fill>): Fill => ({
  ...DEFAULT_APPEARANCE.fill,
  ...change,
});

describe("appearance", () => {
  test("fillCss draws a gradient corner to corner, and a color as its middle stop", () => {
    expect(fillCss(fill({ kind: "gradient", preset: 0 }))).toBe(
      "linear-gradient(135deg, #ffb074 0%, #e8680a 50%, #8a2e0a 100%)",
    );
    expect(fillCss(fill({ kind: "color", preset: 2 }))).toBe("#3b82f6");
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
    expect(fillGradient(fill({ kind: "color", preset: 2 })).stops).toEqual([
      { color: "#3b82f6", at: 0 },
      { color: "#3b82f6", at: 1 },
    ]);
  });

  test("a custom fill draws its own gradient, or its first color as a color", () => {
    const custom = {
      angle: 90,
      stops: [
        { color: "#ff0000", at: 1 },
        { color: "#0000ff", at: 0 },
      ],
    };
    expect(fillCss(fill({ preset: "custom", custom }))).toBe(
      "linear-gradient(90deg, #0000ff 0%, #ff0000 100%)",
    );
    expect(fillCss(fill({ kind: "color", preset: "custom", custom }))).toBe(
      "#ff0000",
    );
  });

  test("changeStop changes one stop and keeps the rest", () => {
    const { custom } = DEFAULT_APPEARANCE.fill;
    const changed = changeStop(custom, 1, { color: "#000000" });
    expect(changed.stops[1]).toEqual({ color: "#000000", at: 0.5 });
    expect(changed.stops[0]).toBe(custom.stops[0]);
    expect(changed.angle).toBe(custom.angle);
  });
});
