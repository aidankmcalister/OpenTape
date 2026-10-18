import { expect, test } from "bun:test";
import { clampAmount, fillCss } from "./look";

test("fillCss should draw a gradient corner to corner", () => {
  expect(fillCss({ kind: "gradient", preset: 0 })).toBe(
    "linear-gradient(135deg, #0f4c5c 0%, #2a9d8f 55%, #e9c46a 100%)",
  );
});

test("fillCss should give a color its gradient's middle stop", () => {
  expect(fillCss({ kind: "color", preset: 2 })).toBe("#3b82f6");
});

test("clampAmount should keep a value within its range, in whole steps", () => {
  expect(clampAmount("padding", 200)).toBe(160);
  expect(clampAmount("radius", -3)).toBe(0);
  expect(clampAmount("shadowBlur", 47.6)).toBe(48);
});
