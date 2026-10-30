import { describe, expect, test } from "bun:test";
import type { VideoSample } from "@/lib/bindings";
import { timeMap } from "./clips";
import {
  type Chunk,
  CHUNK_SAMPLES,
  createFrames,
  type Decoded,
  fillChannels,
  soundParts,
} from "./playback";

describe("frames", () => {
  const SAMPLES: VideoSample[] = Array.from({ length: 100 }, (_, index) => ({
    ms: index * 100,
    isKey: index % 10 === 0,
    size: 2,
  }));

  function fake() {
    const loads: number[][] = [];
    const fed: Chunk[] = [];
    const closed: number[] = [];
    const made: number[] = [];
    let queue: Chunk[] = [];
    let output: (frame: Decoded) => void = () => {};
    let resets = 0;
    const frames = createFrames(
      SAMPLES,
      async (from, to) => {
        loads.push([from, to]);
        return Uint8Array.from({ length: (to - from) * 2 }, (_, at) =>
          Math.floor(at / 2 + from),
        ).buffer;
      },
      (onOutput) => {
        output = onOutput;
        return {
          decode: (chunk) => {
            fed.push(chunk);
            queue.push(chunk);
          },
          flush: async () => {},
          reset: () => {
            resets += 1;
            queue = [];
          },
          close: () => {},
        };
      },
    );
    return {
      frames,
      loads,
      closed,
      fedMs: () => fed.map(({ timestamp }) => timestamp / 1000),
      firstFed: () => fed[0],
      resets: () => resets,
      made,
      output(timestamp: number) {
        made.push(timestamp / 1000);
        output({ timestamp, close: () => closed.push(timestamp / 1000) });
      },
      async deliver() {
        await Bun.sleep(0);
        const delivered = queue;
        queue = [];
        for (const { timestamp } of delivered) this.output(timestamp);
      },
    };
  }

  test("decodes from the keyframe before the playhead and shows the latest frame at or before it", async () => {
    const decoding = fake();
    expect(decoding.frames.frameAt(1250)).toBeNull();
    await decoding.deliver();
    expect(decoding.firstFed()).toMatchObject({ type: "key", timestamp: 1e6 });
    expect([...decoding.firstFed().data]).toEqual([10, 10]);
    expect(decoding.loads).toEqual([
      [0, CHUNK_SAMPLES],
      [CHUNK_SAMPLES, 100],
    ]);
    expect(decoding.frames.frameAt(1250)?.timestamp).toBe(1_200_000);
    expect(decoding.closed).toEqual([1000, 1100]);
  });

  test("keeps a few frames ahead of the playhead and closes the ones it passes", async () => {
    const decoding = fake();
    decoding.frames.frameAt(0);
    await decoding.deliver();
    expect(decoding.fedMs()).toHaveLength(17);
    expect(decoding.frames.frameAt(250)?.timestamp).toBe(200_000);
    expect(decoding.closed).toEqual([0, 100]);
    decoding.frames.frameAt(1450);
    expect(decoding.fedMs().slice(-1)[0]).toBe(2100);
  });

  test("jumps to a later keyframe when the playhead outruns the decoder, and back for a step back", async () => {
    const decoding = fake();
    decoding.frames.frameAt(0);
    await decoding.deliver();
    expect(decoding.frames.frameAt(2050)?.timestamp).toBe(1_500_000);
    expect(decoding.resets()).toBe(0);
    decoding.frames.frameAt(2050);
    expect(decoding.resets()).toBe(1);
    expect(decoding.fedMs().slice(17, 19)).toEqual([2000, 2100]);
    await decoding.deliver();
    expect(decoding.frames.frameAt(2350)?.timestamp).toBe(2_300_000);
    expect(decoding.frames.frameAt(2150)).toBeNull();
    expect(decoding.resets()).toBe(2);
    await decoding.deliver();
    expect(decoding.frames.frameAt(2150)?.timestamp).toBe(2_100_000);
  });

  test("while dragging, lets the first frame after a seek land and shows it once before starting over", async () => {
    const decoding = fake();
    decoding.frames.frameAt(5050);
    await Bun.sleep(0);
    expect(decoding.frames.frameAt(4050)).toBeNull();
    expect(decoding.resets()).toBe(0);
    await decoding.deliver();
    expect(decoding.frames.frameAt(4050)?.timestamp).toBe(5_000_000);
    expect(decoding.frames.frameAt(4050)).toBeNull();
    expect(decoding.resets()).toBe(1);
    await Bun.sleep(0);
    expect(decoding.fedMs()[17]).toBe(4000);
  });

  test("closes every frame exactly once, even ones that arrive after a seek or after closing", async () => {
    const decoding = fake();
    decoding.frames.frameAt(0);
    await decoding.deliver();
    decoding.frames.frameAt(5050);
    decoding.output(300_000);
    await decoding.deliver();
    decoding.frames.close();
    decoding.output(5_200_000);
    expect(decoding.closed.sort()).toEqual(decoding.made.sort());
  });
});

test("sound plays each kept part in output time, faster inside a speed block", () => {
  const time = timeMap(
    [
      { id: 1, startMs: 0, endMs: 2000 },
      { id: 2, startMs: 3000, endMs: 5000 },
    ],
    [{ id: 1, kind: "speed", startMs: 1000, endMs: 2000, amount: 2 }],
    5000,
  );
  expect(soundParts(time.pieces, 500, 2)).toEqual([
    { waitMs: 0, offsetMs: 500, lengthMs: 500, rate: 2 },
    { waitMs: 250, offsetMs: 1000, lengthMs: 1000, rate: 4 },
    { waitMs: 500, offsetMs: 3000, lengthMs: 2000, rate: 2 },
  ]);
  expect(soundParts(time.pieces, 1250, 1)[0]).toEqual({
    waitMs: 0,
    offsetMs: 1500,
    lengthMs: 500,
    rate: 2,
  });
});

test("sound fills two channels from 16-bit stereo", () => {
  const channels = [new Float32Array(2), new Float32Array(2)];
  fillChannels(Int16Array.from([16384, -32768, 0, 8192]).buffer, channels);
  expect(channels.map((channel) => [...channel])).toEqual([
    [0.5, 0],
    [-1, 0.25],
  ]);
});
