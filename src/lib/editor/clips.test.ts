import { describe, expect, test } from "bun:test";
import {
  type Clip,
  cutSpans,
  fitToClips,
  keptClips,
  timeMap,
  removeClip,
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

  test("playback skips each cut, and the last kept frame is the end", () => {
    const clips = [
      { id: 2, startMs: 1000, endMs: 4000 },
      { id: 3, startMs: 6000, endMs: 9000 },
    ];
    const playOn = (ms: number, isLooping = false) =>
      timeMap(clips, [], 10000).playOn(ms, isLooping);
    expect(playOn(0)).toEqual({ ms: 1000, isEnd: false });
    expect(playOn(5000)).toEqual({ ms: 6000, isEnd: false });
    expect(playOn(2000)).toBeNull();
    expect(playOn(9100)).toEqual({ ms: 9000, isEnd: true });
    expect(playOn(9100, true)).toEqual({ ms: 1000, isEnd: false });
    expect(playOn(9000)).toBeNull();
    expect(timeMap(SPLIT, [], 10000).playOn(10000, false)).toBeNull();
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

describe("fitToClips", () => {
  const KEPT: Clip[] = [
    { id: 1, startMs: 0, endMs: 2000 },
    { id: 3, startMs: 5000, endMs: 10000 },
  ];

  test("a modifier shrinks to the footage that is left", () => {
    expect(fitToClips([{ id: 1, startMs: 1000, endMs: 3000 }], KEPT)).toEqual([
      { id: 1, startMs: 1000, endMs: 2000 },
    ]);
    expect(fitToClips([{ id: 1, startMs: 4000, endMs: 7000 }], KEPT)).toEqual([
      { id: 1, startMs: 5000, endMs: 7000 },
    ]);
  });

  test("one with little or nothing left is removed", () => {
    expect(fitToClips([{ id: 1, startMs: 1800, endMs: 4500 }], KEPT)).toEqual(
      [],
    );
    expect(fitToClips([{ id: 1, startMs: 2500, endMs: 4500 }], KEPT)).toEqual(
      [],
    );
  });

  test("one spanning the join keeps both sides, and untouched ones stay the same", () => {
    const spans = [
      { id: 1, startMs: 1000, endMs: 6000 },
      { id: 2, startMs: 6000, endMs: 8000 },
    ];
    expect(fitToClips(spans, KEPT)).toBe(spans);
  });
});

test("the time map speeds playback inside a speed region", () => {
  const time = timeMap(
    [],
    [{ id: 1, kind: "speed", startMs: 2000, endMs: 6000, amount: 2 }],
    10000,
  );
  expect(time.speedAt(1000)).toBe(1);
  expect(time.speedAt(3000)).toBe(2);
});
