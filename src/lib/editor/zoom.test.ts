import { expect, test } from "bun:test";
import type { Point } from "@/lib/geometry";
import { positionAt, withSuggestions } from "./cursor";
import { outputAt, type Region, REGIONS, sourceAt } from "./regions";
import { FRAME_MS } from "./timeline";
import { centeredOn, focusAt, focusBox, zoomPath, zoomTrack } from "./zoom";

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
  expect(focusBox(zoom)).toEqual({ x: 0.5, y: 0.125, width: 0.5, height: 0.5 });
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
  expect(zoomAt(3000).center.x).toBeGreaterThan(0.9);
  expect(zoomAt(3600).center.x).toBeCloseTo(1, 1);
  expect(zoomAt(5300).center.x).toBeCloseTo(1, 4);
});

test("a suggested typing zoom is already on the text when the first letter appears, even sped up", () => {
  const clicks = [{ ms: 3000, x: 0.1, y: 0.1, button: "left" as const }];
  const moves = [{ ms: 0, x: 0.1, y: 0.1 }];
  const keys = Array.from({ length: 30 }, (_, i) => 3700 + i * 120);
  const typed = Array.from({ length: 8 }, (_, i) => ({
    ms: 4200 + i * 500,
    x: 0.4 + i * 0.02,
    y: 0.6,
  }));
  const track = { clicks, keys, moves, typed, pauses: [] };
  const regions = withSuggestions(track, [], 12_000);
  expect(regions.map(({ kind }) => kind)).toEqual(["zoom", "speed"]);
  const field = centeredOn(typed[0], REGIONS.zoom.amount);
  const zoomAt = zoomPath(regions, track, undefined, 12_000);
  const { center } = zoomAt(outputAt(regions, keys[0]));
  expect(Math.hypot(center.x - field.x, center.y - field.y)).toBeLessThan(0.02);
});

test("a following zoom keeps a cursor gliding to a corner in view, but for a moment, and a fixed one loses it", () => {
  const moves = glide(MIDDLE, CORNER, 1000, 2000);
  const zoomAt = zoomPath([following(0, 8000)], { moves, keys: [] });
  const lostMs =
    Array.from({ length: 401 }, (_, step) => step * 20).filter(
      (ms) => !shows(zoomAt(ms), positionAt(moves, ms)),
    ).length * 20;
  expect(lostMs).toBeLessThanOrEqual(100);
  expect(zoomAt(6000).center.x).toBeGreaterThan(0.9);
  const fixed = zoomPath([{ ...following(0, 8000), settings: {} }], {
    moves,
    keys: [],
  });
  expect(shows(fixed(6000), CORNER)).toBe(false);
});

test("small jitter in the middle of the view barely moves it", () => {
  const moves = Array.from({ length: 500 }, (_, step) => ({
    ms: step * 16,
    x: 0.5 + (step % 2 ? 0.01 : -0.01),
    y: 0.5 + (step % 3 ? 0.01 : -0.01),
  }));
  const zoomAt = zoomPath([following(0, 8000)], { moves, keys: [] });
  for (let ms = 0; ms <= 8000; ms += 50) {
    const { center } = zoomAt(ms);
    expect(Math.abs(center.x - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(center.y - 0.5)).toBeLessThan(0.02);
  }
});

test("a following zoom inside a fast region follows the cursor in recording time", () => {
  const regions: Region[] = [
    { id: 2, kind: "speed", startMs: 0, endMs: 8000, amount: 2 },
    following(0, 8000),
  ];
  const moves = glide(MIDDLE, CORNER, 2000, 4000);
  const zoomAt = zoomPath(regions, { moves, keys: [] });
  const lostMs =
    Array.from({ length: 201 }, (_, step) => step * 20).filter(
      (ms) => !shows(zoomAt(ms), positionAt(moves, sourceAt(regions, ms))),
    ).length * 20;
  expect(lostMs).toBeLessThanOrEqual(100);
  expect(zoomAt(3000).center.x).toBeGreaterThan(0.9);
});

test("the export's zoom track follows the cursor the same way as the stage", () => {
  const moves = glide(MIDDLE, CORNER, 1000, 2000);
  const regions = [following(0, 8000)];
  const track = zoomTrack(regions, 8000, { moves, keys: [] });
  const zoomAt = zoomPath(regions, { moves, keys: [] });
  for (const frame of [0, 90, 150, 300]) {
    const { scale, center } = zoomAt(frame * FRAME_MS);
    expect(track[frame]).toEqual({ scale, ...center });
  }
  expect(track[300].x).toBeGreaterThan(0.9);
});

test("while typing, a jittering mouse never pulls the view off the typing", () => {
  const moves = Array.from({ length: 600 }, (_, step) => ({
    ms: step * 10,
    x: 0.8 + (step % 2 ? 0.01 : 0),
    y: 0.7 + (step % 3 ? 0.01 : 0),
  }));
  const keys = Array.from({ length: 40 }, (_, step) => 1000 + step * 100);
  const zoomAt = zoomPath(
    [
      {
        ...following(0, 8000),
        center: MIDDLE,
        path: [{ afterMs: 1000, x: 1, y: 0 }],
      },
    ],
    { moves, keys },
  );
  for (let ms = 1000; ms <= 7000; ms += 50)
    expect(shows(zoomAt(ms), { x: 0.95, y: 0.1 })).toBe(true);
});

test("a pan starts and stops gently, with no sudden jolt", () => {
  const zoomAt = zoomPath([
    {
      id: 1,
      kind: "zoom",
      startMs: 0,
      endMs: 6000,
      amount: 2,
      center: { x: 0, y: 0 },
      path: [{ afterMs: 2000, x: 1, y: 1 }],
    },
  ]);
  const dt = 1000 / 60;
  const xs = Array.from(
    { length: 300 },
    (_, frame) => zoomAt(frame * dt).center.x,
  );
  const accels = xs
    .slice(2)
    .map((x, i) => (x - 2 * xs[i + 1] + xs[i]) / (dt / 1000) ** 2);
  expect(Math.max(...accels.map(Math.abs))).toBeLessThan(15);
});

test("a cursor moving steadily is followed in one glide, with no stops", () => {
  const moves = glide(MIDDLE, { x: 0.74, y: 0.5 }, 1000, 5000);
  const zoomAt = zoomPath([following(0, 8000)], { moves, keys: [] });
  const xs = Array.from(
    { length: 150 },
    (_, step) => zoomAt(1500 + step * 20).center.x,
  );
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  expect(Math.min(...steps)).toBeGreaterThan(0);
});

test("the view holds still while the cursor moves around inside its box, then glides once it leaves", () => {
  const moves = [
    ...glide({ x: 0.45, y: 0.5 }, { x: 0.6, y: 0.5 }, 1000, 2000),
    ...glide({ x: 0.6, y: 0.5 }, { x: 0.45, y: 0.55 }, 2010, 4010),
    ...glide({ x: 0.45, y: 0.55 }, { x: 0.95, y: 0.55 }, 5010, 6010),
  ];
  const zoomAt = zoomPath([following(0, 9000)], { moves, keys: [] });
  const held = zoomAt(2900).center;
  expect(zoomAt(3700).center.x).toBeCloseTo(held.x, 2);
  expect(zoomAt(8000).center.x).toBeGreaterThan(held.x + 0.3);
  expect(shows(zoomAt(8000), { x: 0.95, y: 0.55 })).toBe(true);
});

const TALL = { x: 1, y: 3.2 };

const filled = (
  { scale, center }: { scale: number; center: Point },
  at?: Point,
) =>
  (["x", "y"] as const).every((key) => {
    const crop = TALL[key];
    const onScreen = (share: number) =>
      center[key] + scale * (((crop - 1) / 2 + share) / crop - center[key]);
    const covers = onScreen(0) <= 1e-9 && onScreen(1) >= 1 - 1e-9;
    return (
      covers && (!at || (onScreen(at[key]) >= 0 && onScreen(at[key]) <= 1))
    );
  });

test("Fill keeps a wide recording filling a tall frame and follows the cursor across it", () => {
  const moves = [
    ...glide(MIDDLE, { x: 0.95, y: 0.5 }, 1000, 2000),
    ...glide({ x: 0.95, y: 0.5 }, { x: 0.05, y: 0.8 }, 4000, 5000),
  ];
  const zoomAt = zoomPath([], { moves, keys: [] }, TALL, 8000);
  const times = Array.from({ length: 401 }, (_, step) => step * 20);
  for (const ms of times) {
    expect(zoomAt(ms).scale).toBe(3.2);
    expect(filled(zoomAt(ms))).toBe(true);
  }
  const lostMs =
    times.filter((ms) => !filled(zoomAt(ms), positionAt(moves, ms))).length *
    20;
  expect(lostMs).toBeLessThanOrEqual(400);
  expect(filled(zoomAt(3500), { x: 0.95, y: 0.5 })).toBe(true);
  expect(filled(zoomAt(7000), { x: 0.05, y: 0.8 })).toBe(true);
});

test("Fill keeps the typing in view while the mouse rests elsewhere", () => {
  const moves = [{ ms: 0, x: 0.3, y: 0.6 }];
  const keys = Array.from({ length: 41 }, (_, step) => 1000 + step * 100);
  const typed = Array.from({ length: 9 }, (_, step) => ({
    ms: 1000 + step * 500,
    x: 0.9,
    y: 0.1,
  }));
  const zoomAt = zoomPath([], { moves, keys, typed }, TALL, 8000);
  for (let ms = 1500; ms <= 5000; ms += 50)
    expect(filled(zoomAt(ms), { x: 0.9, y: 0.1 })).toBe(true);
});

test("a zoom in Fill zooms past the fill and the recording still covers the frame", () => {
  const moves = glide(MIDDLE, CORNER, 1000, 2000);
  const zoomAt = zoomPath(
    [following(1000, 4000)],
    { moves, keys: [] },
    TALL,
    6000,
  );
  expect(zoomAt(3000).scale).toBeCloseTo(6.4, 5);
  expect(zoomAt(5500).scale).toBeCloseTo(3.2, 5);
  for (let ms = 0; ms <= 6000; ms += 10) expect(filled(zoomAt(ms))).toBe(true);
});

test("in Fill the focus box is the tall area shown, and dragging it back gives the focus", () => {
  const zoom: Region = {
    id: 1,
    kind: "zoom",
    startMs: 0,
    endMs: 1000,
    amount: 2,
    center: { x: 1, y: 0.5 },
  };
  expect(focusBox(zoom, TALL)).toEqual({
    x: 0.84375,
    y: 0.25,
    width: 0.15625,
    height: 0.5,
  });
  const back = focusAt({ x: 0.84375, y: 0.25 }, 2, TALL);
  expect(back.x).toBeCloseTo(1, 9);
  expect(back.y).toBeCloseTo(0.5, 9);
  expect(
    focusBox({ ...zoom, center: focusAt({ x: 0, y: 0 }, 2, TALL) }, TALL).y,
  ).toBeCloseTo(0, 9);
});
