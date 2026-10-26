import { expect, test } from "bun:test";
import type { Point } from "@/lib/geometry";
import { positionAt } from "./cursor";
import { type Region, sourceAt } from "./regions";
import { FRAME_MS } from "./timeline";
import { focusAt, focusBox, zoomPath, zoomTrack } from "./zoom";

const MIDDLE = { x: 0.5, y: 0.5 };
const CORNER = { x: 0.98, y: 0.98 };

const following = (startMs: number, endMs: number): Region => ({
  id: 1,
  kind: "zoom",
  startMs,
  endMs,
  amount: 2,
  settings: { focus: "Follow cursor" },
});

const glide = (from: Point, to: Point, startMs: number, endMs: number) =>
  Array.from({ length: (endMs - startMs) / 10 + 1 }, (_, step) => {
    const share = (step * 10) / (endMs - startMs);
    return {
      ms: startMs + step * 10,
      x: from.x + (to.x - from.x) * share,
      y: from.y + (to.y - from.y) * share,
    };
  });

const shows = (
  { scale, center }: { scale: number; center: Point },
  at: Point,
) =>
  (["x", "y"] as const).every((key) => {
    const left = center[key] * (1 - 1 / scale);
    return at[key] >= left && at[key] <= left + 1 / scale;
  });

test("the focus box is the zoomed area, and dragging it back gives the focus", () => {
  const zoom: Region = {
    id: 1,
    kind: "zoom",
    startMs: 0,
    endMs: 1000,
    amount: 2,
    center: { x: 1, y: 0.25 },
  };
  expect(focusBox(zoom)).toEqual({ x: 0.5, y: 0.125, size: 0.5 });
  expect(focusAt({ x: 0.5, y: 0.125 }, 2)).toEqual({ x: 1, y: 0.25 });
  expect(focusAt({ x: -0.2, y: 0.9 }, 2)).toEqual({ x: 0, y: 1 });
});

test("a zoom with a click path pans to each click, arriving as it happens", () => {
  const zoomAt = zoomPath([
    {
      id: 1,
      kind: "zoom",
      startMs: 1000,
      endMs: 5000,
      amount: 2,
      center: { x: 0, y: 0 },
      path: [{ afterMs: 2000, x: 1, y: 1 }],
    },
  ]);
  expect(zoomAt(2000).center).toEqual({ x: 0, y: 0 });
  const moving = zoomAt(2500).center;
  expect(moving.x).toBeGreaterThan(0);
  expect(moving.x).toBeLessThan(1);
  expect(zoomAt(3000).center.x).toBeCloseTo(1, 1);
  expect(zoomAt(5300).center.x).toBeCloseTo(1, 4);
});

test("a following zoom keeps a cursor gliding to a corner in view, and a fixed one loses it", () => {
  const moves = glide(MIDDLE, CORNER, 1000, 2000);
  const zoomAt = zoomPath([following(0, 8000)], moves);
  for (let ms = 0; ms <= 8000; ms += 20)
    expect(shows(zoomAt(ms), positionAt(moves, ms))).toBe(true);
  expect(zoomAt(6000).center.x).toBeGreaterThan(0.9);
  const fixed = zoomPath([{ ...following(0, 8000), settings: {} }], moves);
  expect(shows(fixed(6000), CORNER)).toBe(false);
});

test("small jitter in the middle of the view never moves it", () => {
  const moves = Array.from({ length: 500 }, (_, step) => ({
    ms: step * 16,
    x: 0.5 + (step % 2 ? 0.03 : -0.03),
    y: 0.5 + (step % 3 ? 0.02 : -0.02),
  }));
  const zoomAt = zoomPath([following(0, 8000)], moves);
  for (let ms = 0; ms <= 8000; ms += 50)
    expect(zoomAt(ms).center).toEqual(MIDDLE);
});

test("a following zoom inside a fast region follows the cursor in recording time", () => {
  const regions: Region[] = [
    { id: 2, kind: "speed", startMs: 0, endMs: 8000, amount: 2 },
    following(0, 8000),
  ];
  const moves = glide(MIDDLE, CORNER, 2000, 4000);
  const zoomAt = zoomPath(regions, moves);
  for (let ms = 0; ms <= 4000; ms += 20)
    expect(shows(zoomAt(ms), positionAt(moves, sourceAt(regions, ms)))).toBe(
      true,
    );
  expect(zoomAt(3000).center.x).toBeGreaterThan(0.9);
});

test("the export's zoom track follows the cursor the same way as the stage", () => {
  const moves = glide(MIDDLE, CORNER, 1000, 2000);
  const regions = [following(0, 8000)];
  const track = zoomTrack(regions, 8000, moves);
  const zoomAt = zoomPath(regions, moves);
  for (const frame of [0, 90, 150, 300]) {
    const { scale, center } = zoomAt(frame * FRAME_MS);
    expect(track[frame]).toEqual({ scale, ...center });
  }
  expect(track[300].x).toBeGreaterThan(0.9);
});
