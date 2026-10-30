import type { VideoSample } from "@/lib/bindings";
import type { TimeMap } from "./clips";

export type Decoded = { timestamp: number; close: () => void };

export type Chunk = {
  type: "key" | "delta";
  timestamp: number;
  data: Uint8Array;
};

type Decoder = {
  decode: (chunk: Chunk) => void;
  flush: () => Promise<void>;
  reset: () => void;
  close: () => void;
};

export type Frames<F extends Decoded> = {
  frameAt: (ms: number) => F | null;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
};

export const CHUNK_SAMPLES = 60;
const FRAMES_AHEAD = 8;
const WAITING = 16;

const micros = (ms: number) => Math.round(ms * 1000);

export function createFrames<F extends Decoded>(
  samples: VideoSample[],
  load: (from: number, to: number) => Promise<ArrayBuffer>,
  makeDecoder: (output: (frame: F) => void, ready: () => void) => Decoder,
): Frames<F> {
  const starts = samples.map((_, index) => {
    const first = index - (index % CHUNK_SAMPLES);
    return samples
      .slice(first, index)
      .reduce((total, { size }) => total + size, 0);
  });
  const keys = samples.flatMap(({ isKey }, index) => (isKey ? [index] : []));
  const firstMs = samples[0]?.ms ?? 0;
  const chunks = new Map<number, Uint8Array | Promise<void>>();
  const listeners = new Set<() => void>();
  const fed = new Set<number>();
  let run = { start: 0, next: 0, lastFed: -1, isFlushed: false };
  let frames: F[] = [];
  let shown: F | null = null;
  let waiting = 0;
  let wanted = 0;
  let isClosed = false;

  const decoder = makeDecoder((frame) => {
    if (isClosed || !fed.has(frame.timestamp)) return frame.close();
    waiting -= 1;
    frames = [...frames, frame].sort((a, b) => a.timestamp - b.timestamp);
    settle();
    pump();
    for (const listener of listeners) listener();
  }, pump);

  function shownIndex() {
    return frames.filter(({ timestamp }) => timestamp <= wanted).length - 1;
  }

  function settle() {
    const shown = shownIndex();
    if (shown <= 0) return;
    for (const frame of frames.slice(0, shown)) frame.close();
    frames = frames.slice(shown);
  }

  function restart(key: number) {
    if (run.next > run.start) decoder.reset();
    for (const frame of frames) frame.close();
    frames = [];
    waiting = 0;
    fed.clear();
    run = { start: key, next: key, lastFed: -1, isFlushed: false };
  }

  function bytes(index: number) {
    const chunk = Math.floor(index / CHUNK_SAMPLES);
    for (const kept of chunks.keys())
      if (kept < chunk || kept > chunk + 1) chunks.delete(kept);
    for (const wantedChunk of [chunk, chunk + 1]) {
      const from = wantedChunk * CHUNK_SAMPLES;
      if (chunks.has(wantedChunk) || from >= samples.length) continue;
      const loading: Promise<void> = load(
        from,
        Math.min(from + CHUNK_SAMPLES, samples.length),
      ).then((buffer) => {
        if (chunks.get(wantedChunk) !== loading) return;
        chunks.set(wantedChunk, new Uint8Array(buffer));
        pump();
      }, console.error);
      chunks.set(wantedChunk, loading);
    }
    const loaded = chunks.get(chunk);
    if (!(loaded instanceof Uint8Array)) return null;
    return loaded.subarray(starts[index], starts[index] + samples[index].size);
  }

  function pump() {
    if (isClosed) return;
    const room = frames.length > 1 ? FRAMES_AHEAD - frames.length : WAITING;
    while (run.next < samples.length && waiting < room) {
      const data = bytes(run.next);
      if (!data) return;
      const sample = samples[run.next];
      const timestamp = micros(sample.ms);
      fed.add(timestamp);
      run.lastFed = Math.max(run.lastFed, timestamp);
      decoder.decode({ type: sample.isKey ? "key" : "delta", timestamp, data });
      waiting += 1;
      run.next += 1;
    }
    if (run.next === samples.length && !run.isFlushed) {
      run.isFlushed = true;
      decoder.flush().catch(() => {});
    }
  }

  return {
    frameAt(ms) {
      if (isClosed || samples.length === 0) return null;
      wanted = micros(Math.max(ms, firstMs));
      const at =
        keys.filter((index) => micros(samples[index].ms) <= wanted).pop() ?? 0;
      const isPassed = shownIndex() < 0 && frames.length > 0;
      const isOutrun = at > run.start && at >= run.next && wanted > run.lastFed;
      if (at < run.start || isOutrun || isPassed) {
        if (frames.length === 0 && waiting > 0) return null;
        const stale = frames[Math.max(shownIndex(), 0)];
        if (stale && stale !== shown) return (shown = stale);
        restart(at);
      }
      settle();
      pump();
      return (shown = frames[shownIndex()] ?? null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      isClosed = true;
      decoder.close();
      for (const frame of frames) frame.close();
      frames = [];
      chunks.clear();
      listeners.clear();
    },
  };
}

export const SOUND_RATE = 48_000;

export function fillChannels(pcm: ArrayBuffer, channels: Float32Array[]) {
  const interleaved = new Int16Array(pcm);
  for (let index = 0; index < interleaved.length; index += 1)
    channels[index % 2][index >> 1] = interleaved[index] / 32768;
}

export function soundParts(
  pieces: TimeMap["pieces"],
  fromMs: number,
  speed: number,
) {
  return pieces
    .filter(
      ({ startMs, endMs, rate, at }) => at + (endMs - startMs) / rate > fromMs,
    )
    .map(({ startMs, endMs, rate, at }) => {
      const startsAt = Math.max(at, fromMs);
      const offsetMs = startMs + (startsAt - at) * rate;
      return {
        waitMs: (startsAt - fromMs) / speed,
        offsetMs,
        lengthMs: endMs - offsetMs,
        rate: rate * speed,
      };
    });
}
