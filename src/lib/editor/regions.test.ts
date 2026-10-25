import { describe, expect, test } from "bun:test";
import {
  addRegion,
  ALL_KINDS,
  amountAt,
  blockValue,
  changeRegion,
  changeSetting,
  closeRows,
  dragRegion,
  outputAt,
  type Region,
  type RegionDrag,
  regionKindForKey,
  removeRegions,
  removeRegionAt,
  REGIONS,
  rowCount,
  resolveOverlaps,
  settingValue,
} from "./regions";
import { contrastRatio, hueColors, rgbOf } from "./color";

describe("regions", () => {
  const ZOOM_1_TO_3: Region = {
    id: 1,
    kind: "zoom",
    startMs: 1000,
    endMs: 3000,
    amount: 1.5,
  };
  const spans = (regions: Region[]) =>
    regions
      .map(({ startMs, endMs, row }) => `${startMs}-${endMs}@${row ?? 0}`)
      .join(" ");

  test("addRegion adds two seconds of the kind's amount at the playhead", () => {
    expect(addRegion([], "speed", 500, 10_000)[0]).toMatchObject({
      kind: "speed",
      startMs: 500,
      endMs: 2500,
      amount: 2,
    });
  });

  test.each([
    [5000, "1000-3000@0 5000-7000@0", "takes the first row when it has room"],
    [2000, "1000-3000@0 2000-4000@1", "overlaps on a new row, of either kind"],
    [3020, "1000-3000@0 3020-5020@1", "keeps 60ms from the next item in a row"],
    [9000, "1000-3000@0 9000-10000@0", "ends at the end"],
    [
      9900,
      "1000-3000@0 9750-10000@0",
      "starts earlier to keep a quarter second",
    ],
  ])("addRegion at %p gives %p: %s", (atMs, expected) => {
    expect(spans(addRegion([ZOOM_1_TO_3], "speed", atMs, 10_000))).toBe(
      expected,
    );
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
    ["move", 500, "1500-3500@0 5000-6000@0", "moves the whole region"],
    [
      "move",
      3500,
      "4500-6500@1 5000-6000@0",
      "hops a row when it lands on one",
    ],
    ["move", -5000, "0-2000@0 5000-6000@0", "stops at the start"],
    ["start", -400, "600-3000@0 5000-6000@0", "moves just the start"],
    ["start", 5000, "2750-3000@0 5000-6000@0", "keeps a quarter second"],
    ["end", 9000, "1000-10000@1 5000-6000@0", "stretches over the next one"],
  ] as const)("dragRegion %p by %p gives %p: %s", (edge, deltaMs, expected) => {
    expect(drag(edge, deltaMs)).toBe(expected);
  });

  test("dragRegion past the last region stops at the end", () => {
    expect(spans(dragRegion([ZOOM_5_TO_6], 2, "end", 9000, 8000))).toBe(
      "5000-8000@0",
    );
  });

  test("a drag that changes nothing, or a removal of nothing, returns the same regions", () => {
    const regions = [ZOOM_1_TO_3];
    expect(dragRegion(regions, 1, "move", 0, 10_000)).toBe(regions);
    expect(dragRegion(regions, 9, "move", 500, 10_000)).toBe(regions);
    expect(removeRegions(regions, [9])).toBe(regions);
    expect(removeRegions(regions, [1, 9])).toEqual([]);
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

  test("where two of a kind overlap, the later start wins", () => {
    const long = { ...ZOOM_1_TO_3, endMs: 6000 };
    const short = { ...ZOOM_5_TO_6, startMs: 2000, endMs: 3000, amount: 2 };
    expect(
      resolveOverlaps([long, short], "zoom").map(
        ({ id, startMs, endMs }) => `${id}:${startMs}-${endMs}`,
      ),
    ).toEqual(["1:1000-2000", "2:2000-3000", "1:3000-6000"]);
    expect(amountAt([long, short], "zoom", 2500)).toBe(2);
  });

  test("overlapping speeds play the later one where they overlap", () => {
    const regions: Region[] = [
      { id: 1, kind: "speed", startMs: 0, endMs: 4000, amount: 2 },
      { id: 2, kind: "speed", startMs: 1000, endMs: 2000, amount: 4 },
    ];
    expect(outputAt(regions, 4000)).toBe(500 + 250 + 1000);
  });

  test("closeRows closes the rows nothing sits in", () => {
    const regions = [
      { ...ZOOM_1_TO_3, row: 0 },
      { ...ZOOM_5_TO_6, row: 2 },
    ];
    expect(closeRows(regions).map(({ row }) => row)).toEqual([0, 1]);
    expect(rowCount(closeRows(regions))).toBe(2);
    expect(rowCount([])).toBe(1);
  });

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

test.each(Object.entries(REGIONS))(
  "%s reads at 4.5:1 or more at rest, on hover and selected",
  (_, { hue }) => {
    const { rest, hover, text, onHue } = hueColors(rgbOf(hue));
    expect(contrastRatio(text, rest)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, hover)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onHue, rgbOf(hue))).toBeGreaterThanOrEqual(4.5);
  },
);

test("a drag can ask for a row, and lands on the first with room from there", () => {
  const regions: Region[] = [
    { id: 1, kind: "zoom", startMs: 0, endMs: 2000, amount: 1.5, row: 0 },
    { id: 2, kind: "speed", startMs: 0, endMs: 2000, amount: 2, row: 1 },
    { id: 3, kind: "zoom", startMs: 5000, endMs: 6000, amount: 1.5, row: 0 },
  ];
  const rowOf = (moved: Region[]) => moved.find(({ id }) => id === 3)?.row;
  expect(rowOf(dragRegion(regions, 3, "move", 0, 10_000, 4))).toBe(4);
  expect(rowOf(dragRegion(regions, 3, "move", -5000, 10_000, 1))).toBe(2);
});

test.each(ALL_KINDS)("a new %s block shows its default setting", (kind) => {
  const [region] = addRegion([], kind, 0, 10_000);
  expect(blockValue(region)).not.toBe("");
});

test("a setting change reads back, and amount stays on the region", () => {
  const [audio] = addRegion([], "audio", 0, 10_000);
  expect(blockValue(audio)).toBe("80%");
  const louder = { ...audio, ...changeSetting(audio, "volume", 120) };
  expect(settingValue(louder, "volume")).toBe(120);
  const [speed] = addRegion([], "speed", 0, 10_000);
  expect(changeSetting(speed, "amount", "4")).toEqual({ amount: 4 });
});
