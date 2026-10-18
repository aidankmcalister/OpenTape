import { expect, test } from "bun:test";
import {
  centeredArea,
  dragArea,
  fitRatio,
  firstUnder,
  intersect,
  MIN_AREA_SIDE,
  panelPosition,
  setAreaField,
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

test("setAreaField should keep a typed width inside the display", () => {
  expect(setAreaField(BOX, "width", 9999, DISPLAY)).toEqual({
    x: 0,
    y: 100,
    width: 1512,
    height: 300,
  });
});

test("panelPosition should flip above the box when there's no room below", () => {
  const nearBottom = { x: 100, y: 800, width: 400, height: 150 };
  expect(
    panelPosition(nearBottom, { width: 280, height: 140 }, DISPLAY).y,
  ).toBe(648);
});

test("fitRatio should keep the center and the longest side", () => {
  expect(
    fitRatio({ x: 100, y: 100, width: 400, height: 216 }, 16 / 9, DISPLAY),
  ).toEqual({
    x: 100,
    y: 96,
    width: 400,
    height: 225,
  });
});

test("fitRatio should shrink a square to fit a short display", () => {
  const square = fitRatio(centeredArea(DISPLAY), 1, DISPLAY);
  expect(square.width).toBe(982);
  expect(square.height).toBe(982);
  expect(square.y).toBe(0);
});
