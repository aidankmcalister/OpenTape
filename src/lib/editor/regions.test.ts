import { describe, expect, test } from "bun:test";
import {
  addRegion,
  amountAt,
  changeRegion,
  dragRegion,
  type Region,
  type RegionDrag,
  regionKindForKey,
  removeRegion,
  removeRegionAt,
} from "./regions";

describe("regions", () => {
  const ZOOM_1_TO_3: Region = {
    id: 1,
    kind: "zoom",
    startMs: 1000,
    endMs: 3000,
    amount: 1.5,
  };
  const spans = (regions: Region[]) =>
    regions.map(({ startMs, endMs }) => `${startMs}-${endMs}`).join(" ");

  test("addRegion adds two seconds of the kind's amount at the playhead", () => {
    expect(addRegion([], "speed", 500, 10_000)[0]).toMatchObject({
      kind: "speed",
      startMs: 500,
      endMs: 2500,
      amount: 2,
    });
  });

  test.each([
    [0, "0-1000 1000-3000", "stops at the next region"],
    [3000, "1000-3000 3000-5000", "starts where the one before ends"],
    [9000, "1000-3000 9000-10000", "stops at the end"],
    [9750, "1000-3000 9750-10000", "fits a quarter second at the end"],
    [9800, "1000-3000", "adds nothing shorter than a quarter second"],
    [1500, "1000-3000", "adds nothing inside a region, of either kind"],
    [900, "1000-3000", "adds nothing without room before the next region"],
  ])("addRegion at %p gives %p: %s", (atMs, expected) => {
    expect(spans(addRegion([ZOOM_1_TO_3], "speed", atMs, 10_000))).toBe(
      expected,
    );
  });

  test("addRegion keeps regions in time order", () => {
    const both = addRegion(
      addRegion([], "zoom", 6000, 10_000),
      "speed",
      0,
      10_000,
    );
    expect(both.map((region) => region.kind)).toEqual(["speed", "zoom"]);
  });

  test("a region added after a removal gets an id no other region has", () => {
    const two = addRegion([ZOOM_1_TO_3], "speed", 5000, 10_000);
    const added = addRegion(
      two.filter(({ id }) => id !== 1),
      "zoom",
      0,
      10_000,
    );
    const ids = added.map((region) => region.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  const ZOOM_5_TO_6: Region = {
    ...ZOOM_1_TO_3,
    id: 2,
    startMs: 5000,
    endMs: 6000,
  };
  const drag = (edge: RegionDrag, deltaMs: number) =>
    spans(dragRegion([ZOOM_1_TO_3, ZOOM_5_TO_6], 1, edge, deltaMs, 10_000));

  test.each([
    ["move", 500, "1500-3500 5000-6000", "moves the whole region"],
    ["move", 5000, "3000-5000 5000-6000", "stops at the next region"],
    ["move", -5000, "0-2000 5000-6000", "stops at the start"],
    ["start", -400, "600-3000 5000-6000", "moves just the start"],
    ["start", 5000, "2750-3000 5000-6000", "keeps a quarter second"],
    ["end", 9000, "1000-5000 5000-6000", "stops the end at the next region"],
  ] as const)("dragRegion %p by %p gives %p: %s", (edge, deltaMs, expected) => {
    expect(drag(edge, deltaMs)).toBe(expected);
  });

  test("dragRegion past the last region stops at the end", () => {
    expect(spans(dragRegion([ZOOM_5_TO_6], 2, "end", 9000, 8000))).toBe(
      "5000-8000",
    );
  });

  test("a drag that changes nothing, or a removal of nothing, returns the same regions", () => {
    const regions = [ZOOM_1_TO_3];
    expect(dragRegion(regions, 1, "move", 0, 10_000)).toBe(regions);
    expect(dragRegion(regions, 9, "move", 500, 10_000)).toBe(regions);
    expect(removeRegion(regions, 9)).toBe(regions);
    expect(removeRegion(regions, 1)).toEqual([]);
  });

  test("removeRegionAt removes the region under the playhead, and nothing elsewhere", () => {
    expect(removeRegionAt([ZOOM_1_TO_3], 2999)).toEqual([]);
    expect(removeRegionAt([ZOOM_1_TO_3], 3000)).toEqual([ZOOM_1_TO_3]);
  });

  test.each([
    ["zoom", 1500, 1.5],
    ["zoom", 3000, 1],
    ["speed", 1500, 1],
  ] as const)(
    "amountAt(%p, %p) is the region's amount inside it and 1 outside",
    (kind, ms, amount) => {
      expect(amountAt([ZOOM_1_TO_3], kind, ms)).toBe(amount);
    },
  );

  test.each([
    ["z", "zoom"],
    ["S", "speed"],
    ["x", undefined],
  ] as const)("regionKindForKey(%p) matches in either case", (key, kind) => {
    expect(regionKindForKey(key)).toBe(kind);
  });
});

test("changeRegion changes one region, and nothing when nothing changes", () => {
  const regions: Region[] = [
    { id: 1, kind: "zoom", startMs: 0, endMs: 1000, amount: 1.5 },
    { id: 2, kind: "zoom", startMs: 2000, endMs: 3000, amount: 1.5 },
  ];
  const changed = changeRegion(regions, 2, { amount: 2 });
  expect(changed[1].amount).toBe(2);
  expect(changed[0]).toBe(regions[0]);
  expect(changeRegion(regions, 2, { amount: 1.5 })).toBe(regions);
  expect(changeRegion(regions, 9, { amount: 2 })).toBe(regions);
});
