import { describe, expect, test } from "bun:test";
import {
  type Clip,
  clipSeams,
  cutEndAt,
  cutSpans,
  keptClips,
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
    expect(clipSeams(SPLIT)).toEqual([4000]);
    expect(splitClip(SPLIT, 4100, 10000)).toBe(SPLIT);
  });

  test("removeClip leaves a gap, and always keeps one clip", () => {
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
    expect(cutEndAt(clips, 5000, 10000)).toBe(6000);
    expect(cutEndAt(clips, 2000, 10000)).toBeNull();
  });
});
