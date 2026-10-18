import { expect, test } from "bun:test";
import { fitInside, roundedRectPath, firstUnder, intersect } from "./geometry";

const BOX = { x: 100, y: 100, width: 400, height: 300 };

test("firstUnder should pick the front item when two overlap", () => {
  const front = { id: 1, frame: { x: 0, y: 0, width: 500, height: 500 } };
  const back = { id: 2, frame: { x: 0, y: 0, width: 1000, height: 1000 } };
  expect(firstUnder({ x: 10, y: 10 }, [front, back])?.id).toBe(1);
  expect(firstUnder({ x: 700, y: 700 }, [front, back])?.id).toBe(2);
});

test("intersect should be null for rectangles that don't touch", () => {
  expect(intersect(BOX, { x: 600, y: 600, width: 10, height: 10 })).toBeNull();
});

test("fitInside should fill the width of a tall box", () => {
  expect(fitInside({ width: 160, height: 200 }, 16 / 9)).toEqual({
    width: 160,
    height: 90,
  });
});

test("fitInside should fill the height of a wide box", () => {
  expect(fitInside({ width: 400, height: 90 }, 16 / 9)).toEqual({
    width: 160,
    height: 90,
  });
});

test("roundedRectPath should trace a square-cornered rectangle with no corner", () => {
  expect(roundedRectPath({ x: 1, y: 2, width: 10, height: 20 }, 0)).toBe(
    "M1 2H11A0 0 0 0 1 11 2V22A0 0 0 0 1 11 22H1A0 0 0 0 1 1 22V2A0 0 0 0 1 1 2Z",
  );
});
