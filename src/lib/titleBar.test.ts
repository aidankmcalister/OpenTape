import { describe, expect, test } from "bun:test";
import conf from "../../src-tauri/tauri.conf.json";

/**
 * Where AppKit draws the traffic lights for Tauri's `trafficLightPosition`, measured from window
 * captures (macOS 26, 2026-10-19; y 20 and y 34 both fit): each circle is 14pt, the circles are
 * 23pt apart, the first starts at `x`, and their top sits 9pt above `y`.
 */
const CIRCLE = 14;
const LIGHTS_WIDTH = 23 * 2 + CIRCLE;
const TOP_ABOVE_Y = 9;

const css = await Bun.file(new URL("../index.css", import.meta.url)).text();
const token = (name: string) =>
  Number(css.match(new RegExp(`--spacing-${name}: (\\d+)px`))?.[1]);
const editor = conf.app.windows.find((window) => window.label === "editor");
const { x, y } = editor?.trafficLightPosition ?? { x: NaN, y: NaN };
const lightsTop = y - TOP_ABOVE_Y;

describe("the editor's title bar", () => {
  const room = {
    top: lightsTop,
    left: x,
    bottom: token("title-bar") - lightsTop - CIRCLE,
    right: token("traffic-lights") - x - LIGHTS_WIDTH,
  };

  test.each(Object.entries(room))(
    "leaves as much room %s of the traffic lights as on every other side",
    (_, space) => {
      expect(space).toBe(x);
    },
  );
});
