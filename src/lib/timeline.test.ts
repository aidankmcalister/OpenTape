import { expect, test } from "bun:test";
import {
  addRegion,
  amountAt,
  rulerLabel,
  rulerMarks,
  type Region,
} from "./timeline";

const ZOOM_1_TO_3: Region = {
  id: 1,
  kind: "zoom",
  startMs: 1000,
  endMs: 3000,
  amount: 1.5,
};

test("addRegion should add two seconds at the playhead", () => {
  const [added] = addRegion([], "speed", 500, 10_000);
  expect(added).toMatchObject({
    kind: "speed",
    startMs: 500,
    endMs: 2500,
    amount: 2,
  });
});

test("addRegion should stop at the next region or the end", () => {
  const regions = addRegion([ZOOM_1_TO_3], "speed", 0, 10_000);
  expect(regions.map((region) => [region.startMs, region.endMs])).toEqual([
    [0, 1000],
    [1000, 3000],
  ]);
  expect(addRegion([], "zoom", 9000, 10_000)[0].endMs).toBe(10_000);
});

test("addRegion should add nothing inside a region or without room", () => {
  expect(addRegion([ZOOM_1_TO_3], "zoom", 2000, 10_000)).toEqual([ZOOM_1_TO_3]);
  expect(addRegion([ZOOM_1_TO_3], "zoom", 900, 10_000)).toEqual([ZOOM_1_TO_3]);
});

test("amountAt should give the region's amount inside it and 1 outside", () => {
  expect(amountAt([ZOOM_1_TO_3], "zoom", 1500)).toBe(1.5);
  expect(amountAt([ZOOM_1_TO_3], "zoom", 3000)).toBe(1);
  expect(amountAt([ZOOM_1_TO_3], "speed", 1500)).toBe(1);
});

test("rulerMarks should label every two seconds of a 15 second clip", () => {
  const marks = rulerMarks(15_000);
  const labelled = marks.filter((mark) => mark.isMajor).map((mark) => mark.ms);
  expect(labelled).toEqual([0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000]);
  expect(marks[1]).toEqual({ ms: 1000, isMajor: false });
});

test("rulerLabel should read minutes and seconds", () => {
  expect(rulerLabel(4000)).toBe("0:04");
  expect(rulerLabel(75_000)).toBe("1:15");
});
