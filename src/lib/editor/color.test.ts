import { describe, expect, test } from "bun:test";
import { contrastRatio, hexToHsv, hsvToHex, isHex } from "./color";

describe("color", () => {
  test.each([
    ["#ff0000", { h: 0, s: 1, v: 1 }],
    ["#00ff00", { h: 120, s: 1, v: 1 }],
    ["#0000ff", { h: 240, s: 1, v: 1 }],
    ["#000000", { h: 0, s: 0, v: 0 }],
  ])("hexToHsv(%p)", (hex, hsv) => {
    expect(hexToHsv(hex)).toEqual(hsv);
  });

  test("a gray keeps the hue it's given, since it has none of its own", () => {
    expect(hexToHsv("#808080", 200).h).toBe(200);
  });

  test.each(["#2a9d8f", "#e9c46a", "#0f4c5c", "#ffffff"])(
    "%p survives a round trip",
    (hex) => {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    },
  );

  test("contrastRatio runs from 1:1 to 21:1", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
    expect(contrastRatio([90, 90, 90], [90, 90, 90])).toBe(1);
  });

  test("isHex wants a # and six hex digits", () => {
    expect(isHex("#2A9d8f")).toBe(true);
    expect(isHex("2a9d8f")).toBe(false);
    expect(isHex("#2a9d8")).toBe(false);
  });
});
