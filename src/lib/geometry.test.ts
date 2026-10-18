import { expect, test } from "bun:test";
import {
  centeredArea,
  dragArea,
  fitInside,
  fitRatio,
  pixelSize,
  roundedRectPath,
  firstUnder,
  intersect,
  MIN_AREA_SIDE,
  panelPosition,
} from "./geometry";

const DISPLAY = { width: 1512, height: 982 };
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

test("centeredArea should center 1280x720 on the display", () => {
  expect(centeredArea(DISPLAY)).toEqual({
    x: 116,
    y: 131,
    width: 1280,
    height: 720,
  });
});

test("dragArea should stop a moved box at the display edge", () => {
  expect(dragArea(BOX, "move", { x: 5000, y: -5000 }, DISPLAY)).toEqual({
    x: 1112,
    y: 0,
    width: 400,
    height: 300,
  });
});

test("dragArea should grow from a corner but not past the display", () => {
  expect(dragArea(BOX, "se", { x: 50, y: 5000 }, DISPLAY)).toEqual({
    x: 100,
    y: 100,
    width: 450,
    height: 882,
  });
});

test("dragArea should keep a minimum size when a corner passes the opposite one", () => {
  const shrunk = dragArea(BOX, "nw", { x: 1000, y: 1000 }, DISPLAY);
  expect(shrunk.width).toBe(MIN_AREA_SIDE);
  expect(shrunk.height).toBe(MIN_AREA_SIDE);
});

test("panelPosition should sit centered above the box", () => {
  const nearBottom = { x: 100, y: 800, width: 400, height: 150 };
  expect(
    panelPosition(nearBottom, { width: 280, height: 140 }, DISPLAY),
  ).toEqual({
    x: 160,
    y: 648,
  });
});

test("panelPosition should sit inside the box's top when there's no room above", () => {
  const atTop = { x: 0, y: 0, width: 1512, height: 982 };
  expect(panelPosition(atTop, { width: 280, height: 140 }, DISPLAY).y).toBe(12);
});

test("fitRatio should keep the center and about the same area", () => {
  const box = { x: 100, y: 100, width: 640, height: 360 };
  expect(fitRatio(box, 1, DISPLAY)).toEqual({
    x: 180,
    y: 40,
    width: 480,
    height: 480,
  });
});

test("fitRatio should come back to the same box when switched back", () => {
  const box = { x: 100, y: 100, width: 640, height: 360 };
  const square = fitRatio(box, 1, DISPLAY);
  expect(fitRatio(square, 16 / 9, DISPLAY)).toEqual(box);
});

test("fitRatio should cap a tall ratio to most of the display", () => {
  const portrait = fitRatio(centeredArea(DISPLAY), 9 / 16, DISPLAY);
  expect(portrait.height).toBe(Math.round(982 * 0.85));
  expect(portrait.width / portrait.height).toBeCloseTo(9 / 16, 2);
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

test("pixelSize should scale and round down to even pixels", () => {
  expect(pixelSize({ width: 640.6, height: 361 }, 2)).toEqual({
    width: 1280,
    height: 722,
  });
});

test("roundedRectPath should trace a square-cornered rectangle with no corner", () => {
  expect(roundedRectPath({ x: 1, y: 2, width: 10, height: 20 }, 0)).toBe(
    "M1 2H11A0 0 0 0 1 11 2V22A0 0 0 0 1 11 22H1A0 0 0 0 1 1 22V2A0 0 0 0 1 1 2Z",
  );
});

test("panelPosition should stay below the menu bar and notch", () => {
  const nearTop = { x: 100, y: 60, width: 400, height: 300 };
  const panel = { width: 280, height: 56 };
  expect(panelPosition(nearTop, panel, DISPLAY, 38).y).toBe(72);
  const atTop = { x: 100, y: 0, width: 400, height: 300 };
  expect(panelPosition(atTop, panel, DISPLAY, 38).y).toBe(50);
});
