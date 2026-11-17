import { describe, expect, test } from "bun:test";
import {
  type Clip,
  cutSpans,
  fitHidden,
  keptClips,
  timeMap,
  removeClip,
  restoreCut,
  splitClip,
  trimClip,
} from "./clips";

const SPLIT: Clip[] = [
  { id: 1, startMs: 0, endMs: 4000 },
  { id: 2, startMs: 4000, endMs: 10000 },
];

describe("clips", () => {
  test("no clips keeps the whole recording", () => {
    expect(keptClips([], 10000)).toEqual([{ id: 1, startMs: 0, endMs: 10000 }]);
    expect(cutSpans([], 10000)).toEqual([]);
  });

  test("splitClip cuts the clip under the playhead in two, but not near an edge", () => {
    expect(splitClip([], 4000, 10000)).toEqual(SPLIT);
    expect(splitClip(SPLIT, 4100, 10000)).toBe(SPLIT);
  });

  test("removeClip drops the clip, and always keeps one clip", () => {
    expect(removeClip(SPLIT, 1, 10000)).toEqual([SPLIT[1]]);
    const whole: Clip[] = [];
    expect(removeClip(whole, 1, 10000)).toBe(whole);
  });

  test("restoreCut joins the clips around a cut and brings back what it removed", () => {
    const gap: Clip[] = [
      { id: 1, startMs: 0, endMs: 2000 },
      { id: 3, startMs: 5000, endMs: 7000 },
      { id: 4, startMs: 8000, endMs: 10000 },
    ];
    expect(restoreCut(gap, 3)).toEqual([
      { id: 1, startMs: 0, endMs: 7000 },
      gap[2],
    ]);
    expect(restoreCut(SPLIT, 2)).toEqual([{ id: 1, startMs: 0, endMs: 10000 }]);
    expect(restoreCut(gap, 1)).toBe(gap);
    expect(restoreCut(gap, 9)).toBe(gap);
  });

  test("an inner edge brings back removed footage or trims more, keeping 200 ms", () => {
    const gap: Clip[] = [
      { id: 1, startMs: 0, endMs: 2000 },
      { id: 3, startMs: 5000, endMs: 10000 },
    ];
    expect(trimClip(gap, 1, "end", 1000, 10000)[0].endMs).toBe(3000);
    expect(trimClip(gap, 1, "end", 9000, 10000)[0].endMs).toBe(5000);
    expect(trimClip(gap, 3, "start", -1000, 10000)[1].startMs).toBe(4000);
    expect(trimClip(gap, 1, "end", -5000, 10000)[0].endMs).toBe(200);
    expect(trimClip(gap, 3, "start", 9000, 10000)[1].startMs).toBe(9800);
  });

  test("trimClip moves an edge, but not past the next clip", () => {
    expect(trimClip([], 1, "start", 1500, 10000)).toEqual([
      { id: 1, startMs: 1500, endMs: 10000 },
    ]);
    expect(trimClip(SPLIT, 1, "end", 2000, 10000)).toBe(SPLIT);
    expect(trimClip(SPLIT, 2, "end", -500, 10000)).toEqual([
      SPLIT[0],
      { id: 2, startMs: 4000, endMs: 9500 },
    ]);
  });

  test("the cuts are the stretches no clip keeps", () => {
    const clips = [
      { id: 2, startMs: 1000, endMs: 4000 },
      { id: 3, startMs: 6000, endMs: 9000 },
    ];
    expect(cutSpans(clips, 10000)).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 4000, endMs: 6000 },
      { startMs: 9000, endMs: 10000 },
    ]);
    expect(cutSpans(SPLIT, 10000)).toEqual([]);
  });
});

describe("time map", () => {
  const GAP: Clip[] = [
    { id: 1, startMs: 0, endMs: 2000 },
    { id: 3, startMs: 5000, endMs: 10000 },
  ];
  const time = timeMap(GAP, [], 10000);

  test("deleted stretches close up, so the timeline gets shorter", () => {
    expect(time.lengthMs).toBe(7000);
    expect(time.clips.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 2000],
      [2000, 7000],
    ]);
    expect(time.at(6000)).toBe(3000);
    expect(time.at(3000)).toBe(2000);
    expect(time.source(3000)).toBe(6000);
    expect(time.source(2000, "start")).toBe(5000);
    expect(time.source(2000, "end")).toBe(2000);
  });

  test("each cut sits between two clips and knows the footage it removed", () => {
    expect(time.cuts).toEqual([
      { atMs: 2000, removedMs: 3000, beforeId: 1, afterId: 3 },
    ]);
    expect(timeMap(SPLIT, [], 10000).cuts).toEqual([
      { atMs: 4000, removedMs: 0, beforeId: 1, afterId: 2 },
    ]);
    expect(timeMap([], [], 10000).cuts).toEqual([]);
  });

  test("a modifier keeps its moment, and one inside a deleted stretch hides", () => {
    const regions = [
      { id: 1, startMs: 6000, endMs: 7000 },
      { id: 2, startMs: 3000, endMs: 4000 },
    ];
    expect(time.shown(regions)).toEqual([
      { id: 1, startMs: 3000, endMs: 4000 },
    ]);
  });

  test("edits happen in kept time and land back on the recording", () => {
    const regions = [
      { id: 1, startMs: 6000, endMs: 7000 },
      { id: 2, startMs: 3000, endMs: 4000 },
    ];
    const moved = time.edit(regions, (shown) =>
      shown.map((span) => ({ ...span, startMs: 500, endMs: 1500 })),
    );
    expect(moved).toEqual([
      { id: 1, startMs: 500, endMs: 1500 },
      { id: 2, startMs: 3000, endMs: 4000 },
    ]);
    expect(time.edit(regions, (shown) => shown)).toBe(regions);
  });

  test("an edit keeps the regions in their order, hidden ones too", () => {
    const regions = [
      { id: 2, startMs: 3000, endMs: 4000 },
      { id: 1, startMs: 6000, endMs: 7000 },
      { id: 3, startMs: 8000, endMs: 9000 },
    ];
    const moved = time.edit(regions, (shown) => [
      ...shown
        .filter(({ id }) => id !== 3)
        .map((span) => ({ ...span, startMs: 500, endMs: 1500 })),
      { id: 4, startMs: 6000, endMs: 6500 },
    ]);
    expect(moved.map(({ id }) => id)).toEqual([2, 1, 4]);
    expect(moved[1]).toEqual({ id: 1, startMs: 500, endMs: 1500 });
  });

  test("leaps move in kept time, so they jump over deleted footage", () => {
    expect(time.leap(1900, 1000)).toBe(5900);
    expect(time.leap(5500, -1000)).toBe(1500);
    expect(time.leap(9500, 1000)).toBe(10000);
    expect(time.leap(500, -1000)).toBe(0);
  });

  test("a frame step across a join lands on the first frame past it", () => {
    expect(time.step(1990, 1)).toBe(5000);
    expect(time.step(5005, -1)).toBe(2000);
    expect(time.step(1010, 1)).toBeCloseTo(1025, 2);
    expect(
      timeMap([{ id: 2, startMs: 1000, endMs: 9000 }], [], 10000).step(8995, 1),
    ).toBe(9000);
  });
});

test("output time skips cuts and runs faster inside a speed region", () => {
  const time = timeMap(
    [
      { id: 1, startMs: 1000, endMs: 4000 },
      { id: 2, startMs: 6000, endMs: 9000 },
    ],
    [{ id: 1, kind: "speed", startMs: 2000, endMs: 7000, amount: 4 }],
    10000,
  );
  expect(time.pieces).toEqual([
    { startMs: 1000, endMs: 2000, rate: 1, at: 0 },
    { startMs: 2000, endMs: 4000, rate: 4, at: 1000 },
    { startMs: 6000, endMs: 7000, rate: 4, at: 1500 },
    { startMs: 7000, endMs: 9000, rate: 1, at: 1750 },
  ]);
  expect(time.outputMs).toBe(3750);
  expect([0, 1500, 3000, 5000, 9000].map(time.outputAt)).toEqual([
    0, 500, 1250, 1500, 3750,
  ]);
  expect([0, 1250, 1500, 3750, 4000].map(time.sourceAt)).toEqual([
    1000, 3000, 6000, 9000, 9000,
  ]);
});

test("on Restore, a block hidden in removed footage gives way to a block of its kind now on its spot", () => {
  const clips: Clip[] = [
    { id: 1, startMs: 0, endMs: 2000 },
    { id: 2, startMs: 6000, endMs: 10000 },
  ];
  const block = (id: number, startMs: number, endMs: number) =>
    ({ id, kind: "zoom", startMs, endMs, amount: 1.5 }) as const;
  // Hidden 2.5–5 s; a zoom added in kept time landed at 4.9–6.5 s, and one at 1–2.6 s.
  const regions = [
    block(1, 2500, 5000),
    block(2, 4900, 6500),
    block(3, 1000, 2600),
  ];
  expect(fitHidden(regions, clips, 10000)).toEqual([
    block(1, 2600, 4900),
    block(2, 4900, 6500),
    block(3, 1000, 2600),
  ]);
  // Less than the minimum left: it goes.
  expect(
    fitHidden([block(1, 2500, 2800), block(2, 2650, 6500)], clips, 10000),
  ).toEqual([block(2, 2650, 6500)]);
  const apart = [block(1, 2700, 4800), block(3, 1000, 2600)];
  expect(fitHidden(apart, clips, 10000)).toBe(apart);
});
