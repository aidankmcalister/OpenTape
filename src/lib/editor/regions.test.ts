import { describe, expect, test } from "bun:test";
import {
  addRegion,
  KINDS,
  amountAt,
  blockValue,
  changeRegion,
  changeSetting,
  coveredStretches,
  dragRegions,
  nextId,
  touchingSides,
  winnersAt,
  laneKinds,
  outputAt,
  type Region,
  type RegionDrag,
  regionKindForKey,
  removeRegions,
  removeRegionAt,
  REGIONS,
  resolveOverlaps,
  winnerAt,
  settleSuggestion,
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
    [5000, "1000-3000 5000-7000", "adds at the playhead"],
    [2000, "1000-3000 2000-4000", "overlaps another type"],
    [9000, "1000-3000 9000-10000", "ends at the end"],
    [9900, "1000-3000 9800-10000", "starts earlier to keep 0.2s"],
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
  const drag = (ids: number[], edge: RegionDrag, deltaMs: number) =>
    spans(dragRegions([ZOOM_1_TO_3, ZOOM_5_TO_6], ids, edge, deltaMs, 10_000));

  test.each([
    [[1], "move", 520, "1500-3500 5000-6000", "moves to the 0.1s grid"],
    [[1], "move", 2500, "3000-5000 5000-6000", "stops at a block of its type"],
    [
      [1],
      "move",
      3600,
      "6000-8000 5000-6000",
      "jumps past once nearer the far side",
    ],
    [[1], "end", 3000, "1000-5000 5000-6000", "stretches up to its neighbor"],
    [[1], "move", -5000, "0-2000 5000-6000", "stops at the start"],
    [
      [1, 2],
      "move",
      5000,
      "5000-7000 9000-10000",
      "moves a group until its last block hits the end",
    ],
    [[1], "start", -440, "600-3000 5000-6000", "moves just the start"],
    [[1], "start", 5000, "2800-3000 5000-6000", "keeps 0.2s"],
    [[1, 2], "end", 400, "1000-3400 5000-6400", "stretches each selected end"],
  ] as const)(
    "dragRegions %p %p by %p gives %p: %s",
    (ids, edge, deltaMs, expected) => {
      expect(drag([...ids], edge, deltaMs)).toBe(expected);
    },
  );

  test("a drag that changes nothing, or a removal of nothing, returns the same regions", () => {
    const regions = [ZOOM_1_TO_3];
    expect(dragRegions(regions, [1], "move", 0, 10_000)).toBe(regions);
    expect(dragRegions(regions, [9], "move", 500, 10_000)).toBe(regions);
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

  test("lanes follow the registry order, and the later start wins a lane", () => {
    const speed: Region = { ...ZOOM_1_TO_3, id: 3, kind: "speed" };
    const late = { ...ZOOM_5_TO_6, startMs: 2000, endMs: 4000 };
    expect(laneKinds([speed, ZOOM_1_TO_3])).toEqual(["zoom", "speed"]);
    expect(winnerAt([ZOOM_1_TO_3, late], "zoom", 2500)?.id).toBe(2);
    expect(winnerAt([ZOOM_1_TO_3, late], "zoom", 1500)?.id).toBe(1);
    expect(winnerAt([ZOOM_1_TO_3, late], "speed", 1500)).toBeUndefined();
    expect(coveredStretches([ZOOM_1_TO_3, late], ZOOM_1_TO_3)).toEqual([
      { startMs: 2000, endMs: 3000 },
    ]);
    expect(coveredStretches([ZOOM_1_TO_3, late], late)).toEqual([]);
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

test.each(KINDS)("a new %s block shows its default setting", (kind) => {
  const [region] = addRegion([], kind, 0, 10_000);
  expect(blockValue(region)).not.toBe("");
});

test("a setting change reads back, and amount stays on the region", () => {
  const [speed] = addRegion([], "speed", 0, 10_000);
  expect(changeSetting(speed, "amount", "4")).toEqual({ amount: 4 });
});

test.each([
  [2000, "1000-3000 3000-5000", "lands right after the block it's on"],
  [500, "1000-3000 500-1000", "ends where the next block of its type starts"],
])("adding a zoom at %p gives %p: %s", (atMs, expected) => {
  const zoom: Region = {
    id: 1,
    kind: "zoom",
    startMs: 1000,
    endMs: 3000,
    amount: 1.5,
  };
  expect(
    addRegion([zoom], "zoom", atMs, 10_000)
      .map(({ startMs, endMs }) => `${startMs}-${endMs}`)
      .join(" "),
  ).toBe(expected);
});

test("a zoom isn't added when its lane has no room", () => {
  const full: Region = {
    id: 1,
    kind: "zoom",
    startMs: 0,
    endMs: 10_000,
    amount: 1.5,
  };
  expect(addRegion([full], "zoom", 5000, 10_000)).toEqual([full]);
});

test("contrastRatio runs from 1:1 to 21:1", () => {
  expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
  expect(contrastRatio([90, 90, 90], [90, 90, 90])).toBe(1);
});

type Rgb = [number, number, number];

function rgbOf(hue: string): Rgb {
  const [r, g, b] = hue.split(" ").map(Number);
  return [r, g, b];
}

function hueColors(hue: Rgb) {
  const track: Rgb = [31, 31, 34];
  return {
    rest: mixRgb(hue, track, 0.18),
    hover: mixRgb(hue, track, 0.3),
    text: mixRgb(hue, [255, 255, 255], 0.65),
    onHue: [13, 13, 15] as Rgb,
  };
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function mixRgb(a: Rgb, b: Rgb, share: number): Rgb {
  const [r, g, bl] = a.map((value, i) => value * share + b[i] * (1 - share));
  return [r, g, bl];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("block length rules", () => {
  const zoom = (id: number, startMs: number, endMs: number): Region => ({
    id,
    kind: "zoom",
    startMs,
    endMs,
    amount: 1.5,
  });

  test("a block shorter than the minimum can grow from its start but never onto its neighbor", () => {
    const regions = [zoom(1, 0, 2000), zoom(2, 2000, 2300)];
    const nudged = dragRegions(regions, [2], "start", 100, 10_000, 800);
    expect(nudged[1]).toMatchObject({ startMs: 2000, endMs: 2300 });
    const pulled = dragRegions(regions, [2], "start", -500, 10_000, 800);
    expect(pulled[1].startMs).toBe(2000);
  });

  test("a block shorter than the minimum can grow from its end but not shrink", () => {
    const regions = [zoom(1, 1000, 1300)];
    expect(dragRegions(regions, [1], "end", -100, 10_000, 800)[0].endMs).toBe(
      1300,
    );
    expect(dragRegions(regions, [1], "end", 400, 10_000, 800)[0].endMs).toBe(
      1700,
    );
  });

  test("a new block needs a gap of at least the minimum", () => {
    const regions = [zoom(1, 0, 2000), zoom(2, 2250, 5000)];
    const [, , added] = addRegion(regions, "zoom", 2100, 10_000, 800);
    expect(added.startMs).toBeGreaterThanOrEqual(5000);
  });
});

describe("who wins and who touches", () => {
  const zoom = (id: number, startMs: number, endMs: number): Region => ({
    id,
    kind: "zoom",
    startMs,
    endMs,
    amount: 1.5,
  });
  const regions = [
    zoom(1, 0, 1000),
    zoom(2, 1000, 2000),
    { ...zoom(3, 500, 1500), kind: "speed" } satisfies Region,
  ];

  test("winnersAt gives one modifier per type at a moment", () => {
    expect(winnersAt(regions, 1200).map(({ id }) => id)).toEqual([2, 3]);
    expect(winnersAt(regions, 2500)).toEqual([]);
  });

  test("touchingSides finds same-type neighbors that share an edge", () => {
    expect(touchingSides(regions, regions[0])).toEqual({
      start: false,
      end: true,
    });
    expect(touchingSides(regions, regions[1])).toEqual({
      start: true,
      end: false,
    });
    expect(touchingSides(regions, regions[2])).toEqual({
      start: false,
      end: false,
    });
  });

  test("nextId is one past the highest id", () => {
    expect(nextId([])).toBe(1);
    expect(nextId(regions)).toBe(4);
  });
});

test("settleSuggestion keeps a suggestion as a plain region, or removes it", () => {
  const suggested = {
    id: 1,
    kind: "zoom" as const,
    startMs: 0,
    endMs: 1000,
    amount: 1.5,
    isSuggested: true,
  };
  const other = { ...suggested, id: 2, startMs: 2000, endMs: 3000 };
  const [kept] = settleSuggestion([suggested, other], 1, true);
  expect(kept).toEqual({
    id: 1,
    kind: "zoom",
    startMs: 0,
    endMs: 1000,
    amount: 1.5,
  });
  expect(settleSuggestion([suggested, other], 1, false)).toEqual([other]);
});
