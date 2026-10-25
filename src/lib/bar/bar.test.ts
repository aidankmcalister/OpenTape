import { expect, test } from "bun:test";
import type { Phase } from "@/lib/bindings";
import { barLayer, DEFAULT_OPTIONS, elapsedMsAt, parseOptions } from "./bar";

test.each([
  ["nothing was saved", null],
  ["the save isn't JSON", "{camera"],
  ["null was saved", "null"],
])("parseOptions gives the defaults when %s", (_, saved) => {
  expect(parseOptions(saved)).toEqual(DEFAULT_OPTIONS);
});

test("parseOptions fills what an older save left out from the defaults", () => {
  expect(parseOptions('{"cameraId":"facetime"}')).toEqual({
    ...DEFAULT_OPTIONS,
    cameraId: "facetime",
  });
});

test("parseOptions reads back what was saved", () => {
  const saved = { cameraId: "cam", microphoneId: "mic", systemAudio: true };
  expect(parseOptions(JSON.stringify(saved))).toEqual(saved);
});

test.each<[Phase, string | null, string]>([
  ["idle", null, "setup"],
  ["idle", "Screen recording is off", "error"],
  ["starting", null, "recording"],
  ["recording", "Restart failed", "recording"],
  ["paused", null, "recording"],
  ["stopping", "Restart failed", "recording"],
])("barLayer(%p, %p) shows %p", (phase, error, layer) => {
  expect(barLayer(phase, error)).toBe(layer);
});

test.each<[string, Phase, number, number, number]>([
  ["counts on from Rust's time while recording", "recording", 1000, 3500, 7500],
  ["holds Rust's time while paused", "paused", 1000, 60_000, 5000],
  ["holds Rust's time while stopping", "stopping", 1000, 60_000, 5000],
  [
    "adds nothing for a tick from before the status",
    "recording",
    2000,
    1500,
    5000,
  ],
])("elapsedMsAt %s", (_, phase, receivedAt, now, elapsed) => {
  const status = { phase, error: null, elapsedMs: 5000 };
  expect(elapsedMsAt(status, receivedAt, now)).toBe(elapsed);
});
