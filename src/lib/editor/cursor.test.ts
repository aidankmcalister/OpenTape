import { expect, test } from "bun:test";
import {
  readClicks,
  ringCircles,
  ringEvents,
  ringsAt,
  type CursorClick,
} from "./cursor";
import type { Region } from "./regions";

const META = JSON.stringify({
  first_frame_time: 100,
  screen_rect: { x: 0, y: 40, width: 2000, height: 1000 },
  pauses: [[103, 105]],
});

const EVENTS = [
  '{"type":"move","t":100.5,"x":10,"y":50}',
  '{"type":"down","t":99,"x":10,"y":50,"button":"left"}',
  '{"type":"down","t":101,"x":500,"y":540,"button":"left"}',
  '{"type":"up","t":101.1,"x":500,"y":540,"button":"left"}',
  '{"type":"down","t":104,"x":1000,"y":540,"button":"left"}',
  '{"type":"down","t":106,"x":1500,"y":290,"button":"right"}',
].join("\n");

test("clicks land in video time and video space, skipping pauses and anything before the first frame", () => {
  expect(readClicks(META, EVENTS)).toEqual([
    { ms: 1000, x: 0.25, y: 0.5, button: "left" },
    { ms: 4000, x: 0.75, y: 0.25, button: "right" },
  ]);
});

const CLICKS: CursorClick[] = [
  { ms: 1000, x: 0.25, y: 0.5, button: "left" },
  { ms: 4000, x: 0.75, y: 0.25, button: "right" },
];

const RING: Region = {
  id: 1,
  kind: "clickRing",
  startMs: 0,
  endMs: 5000,
  amount: 0,
  settings: { color: "orange", size: 40, style: "Pulse" },
};

test("a click ring block rings every left click it covers, and right clicks only when asked", () => {
  expect(ringEvents(CLICKS, [RING])).toEqual([
    { ms: 1000, x: 0.25, y: 0.5, color: "#ff7a1a", size: 40, style: "pulse" },
  ]);
  const both = { ...RING, settings: { ...RING.settings, rightClick: true } };
  expect(ringEvents(CLICKS, [both])).toHaveLength(2);
  expect(ringEvents(CLICKS, [])).toEqual([]);
});

test("a ring shows for half a second after its click", () => {
  const rings = ringEvents(CLICKS, [RING]);
  expect(ringsAt(rings, 999)).toEqual([]);
  expect(ringsAt(rings, 1250)[0].circles[0].alpha).toBeCloseTo(0.25);
  expect(ringsAt(rings, 1500)).toEqual([]);
});

test("a ring grows and fades, and a ripple sends a second one after it", () => {
  expect(ringCircles("ring", 0, 100)).toEqual([
    { radius: 20, alpha: 1, isFilled: false },
  ]);
  expect(ringCircles("ripple", 0.2, 100)).toHaveLength(1);
  expect(ringCircles("ripple", 0.5, 100)).toHaveLength(2);
});
