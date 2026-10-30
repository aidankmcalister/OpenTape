import { describe, expect, test } from "bun:test";
import {
  changeStop,
  DEFAULT_APPEARANCE,
  fillCss,
  fillGradient,
  frameLayout,
  gradientCss,
  readAppearance,
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

  test("frameLayout in Auto takes the recording's shape, as a matching size does", () => {
    const canvas = { width: 1056, height: 1000 };
    const auto = frameLayout(DEFAULT_APPEARANCE, canvas, 16 / 9);
    expect(auto).toEqual(
      frameLayout({ ...DEFAULT_APPEARANCE, size: "16:9" }, canvas, 16 / 9),
    );
    expect(auto.frame).toEqual({ width: 960, height: 540 });
  });

  test("frameLayout letterboxes a wide recording in a 9:16 frame, inside the padding", () => {
    const { frame, recording, scale } = frameLayout(
      { ...DEFAULT_APPEARANCE, size: "9:16" },
      { width: 1056, height: 1000 },
      16 / 9,
    );
    expect(frame).toEqual({ width: 508.5, height: 904 });
    expect(recording.width).toBeCloseTo(frame.width - 2 * 64 * scale, 5);
    expect(recording.width / recording.height).toBeCloseTo(16 / 9, 5);
    expect(recording.height).toBeLessThan(frame.height / 2);
  });

  test("frameLayout with no margin fills a canvas of the frame's shape, as the preview does", () => {
    const { frame } = frameLayout(
      DEFAULT_APPEARANCE,
      { width: 360, height: 202.5 },
      16 / 9,
      0,
    );
    expect(frame).toEqual({ width: 360, height: 202.5 });
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

test("gradientCss sorts its stops and rounds them to whole percents", () => {
  expect(
    gradientCss({
      angle: 90,
      stops: [
        { color: "#ffffff", at: 1 },
        { color: "#000000", at: 0.333 },
      ],
    }),
  ).toBe("linear-gradient(90deg, #000000 33%, #ffffff 100%)");
});

test("readAppearance fills in defaults", () => {
  expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  expect(readAppearance({ size: "9:16" }).fit).toBe("Letterbox");
});

test("an image fill covers the frame on the Image tab, and falls back to the gradient without one", () => {
  const src = (name: string) => `asset://localhost/${name}`;
  const image = fill({ kind: "image", image: "background.png" });
  const gradient = fillCss(fill({ kind: "gradient" }));
  expect(fillCss(image, src)).toBe(
    'center / cover no-repeat url("asset://localhost/background.png")',
  );
  expect(fillCss({ ...image, kind: "gradient" }, src)).toBe(gradient);
  expect(fillCss({ ...image, image: null }, src)).toBe(gradient);
  const { kind, preset, custom } = DEFAULT_APPEARANCE.fill;
  const older = { kind, preset, custom } as Fill;
  expect(readAppearance({ fill: older }).fill.image).toBeNull();
});
