import { expect, test } from "bun:test";
import type { Region } from "./regions";
import { focusAt, focusBox, zoomAt } from "./zoom";

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
  const zoom: Region = {
    id: 1,
    kind: "zoom",
    startMs: 1000,
    endMs: 5000,
    amount: 2,
    center: { x: 0, y: 0 },
    path: [{ afterMs: 2000, x: 1, y: 1 }],
  };
  expect(zoomAt([zoom], 2000).center).toEqual({ x: 0, y: 0 });
  const moving = zoomAt([zoom], 2500).center;
  expect(moving.x).toBeGreaterThan(0);
  expect(moving.x).toBeLessThan(1);
  expect(zoomAt([zoom], 3000).center).toEqual({ x: 1, y: 1 });
  expect(zoomAt([zoom], 5300).center).toEqual({ x: 1, y: 1 });
});
