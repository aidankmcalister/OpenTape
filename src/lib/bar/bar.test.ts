import { expect, test } from "bun:test";
import type { Phase } from "@/lib/bindings";
import {
  barLayer,
  DEFAULT_OPTIONS,
  elapsedMsAt,
  parseOptions,
  recentLabel,
  recentSummary,
} from "./bar";

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

test.each([
  [
    new Date(2026, 9, 24, 19, 36),
    12_400_000,
    true,
    "Today, 7:36 PM · 12 MB · Edited",
  ],
  [new Date(2026, 9, 23, 9, 5), 300_000, false, "Yesterday, 9:05 AM · 1 MB"],
  [
    new Date(2026, 9, 18, 23, 29),
    2_350_000_000,
    false,
    "Oct 18, 11:29 PM · 2.4 GB",
  ],
])(
  "recentLabel names %p by day, time and size",
  (at, sizeBytes, isEdited, label) => {
    const recording = {
      folder: "x",
      modifiedMs: at.getTime(),
      sizeBytes,
      isEdited,
      isRecovered: false,
    };
    expect(recentLabel(recording, new Date(2026, 9, 24, 21, 0))).toBe(label);
  },
);

test("a recording cut off mid-recording says so first, and the footer adds them up", () => {
  const cutOff = {
    folder: "x",
    modifiedMs: new Date(2026, 9, 24, 19, 36).getTime(),
    sizeBytes: 4_000_000,
    isEdited: false,
    isRecovered: true,
  };
  expect(recentLabel(cutOff, new Date(2026, 9, 24, 21, 0))).toBe(
    "Recovered · Today, 7:36 PM · 4 MB",
  );
  expect(recentSummary([cutOff])).toBe("1 recording · 4 MB");
  expect(recentSummary([cutOff, { ...cutOff, sizeBytes: 1_200_000_000 }])).toBe(
    "2 recordings · 1.2 GB",
  );
});
