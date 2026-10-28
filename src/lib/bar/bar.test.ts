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

test.each<[Phase, string | null, boolean | null, string]>([
  ["idle", null, true, "setup"],
  ["idle", null, null, "setup"],
  ["idle", "Screen recording is off", true, "error"],
  ["idle", null, false, "permission"],
  ["idle", "Screen recording is off", false, "permission"],
  ["starting", null, true, "recording"],
  ["recording", "Restart failed", true, "recording"],
  ["recording", null, false, "recording"],
  ["paused", null, true, "recording"],
  ["stopping", "Restart failed", true, "recording"],
])(
  "barLayer(%p, %p, screen access %p) shows %p",
  (phase, error, hasScreenAccess, layer) => {
    expect(barLayer(phase, error, hasScreenAccess)).toBe(layer);
  },
);

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
  const status = {
    phase,
    error: null,
    elapsedMs: 5000,
    microphoneRefused: false,
  };
  expect(elapsedMsAt(status, receivedAt, now)).toBe(elapsed);
});
