import { expect, test } from "bun:test";
import type { Access, Phase } from "@/lib/bindings";
import type { News } from "@/lib/update";
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

test.each<[Phase, Access | undefined, string | null, News | null, string]>([
  ["idle", "allowed", null, null, "setup"],
  ["idle", undefined, null, null, "setup"],
  ["idle", "allowed", null, "available", "updateAvailable"],
  ["idle", "allowed", "Recording failed", "ready", "error"],
  ["idle", "notAsked", null, "ready", "permission"],
  ["idle", "notAsked", "Recording failed", null, "permission"],
  ["idle", "needsRestart", null, "ready", "restart"],
  ["starting", "allowed", null, "ready", "recording"],
  ["recording", "allowed", "Restart failed", null, "recording"],
  ["recording", "notAsked", null, null, "recording"],
  ["paused", "allowed", null, "ready", "recording"],
  ["stopping", "allowed", "Restart failed", null, "recording"],
])(
  "barLayer(%p, screen %p, error %p, update %p) shows %p",
  (phase, screenRecording, error, update, layer) => {
    expect(
      barLayer({
        phase,
        isCountingDown: false,
        screenRecording,
        error,
        update,
      }),
    ).toBe(layer);
  },
);

test("barLayer shows the countdown while it counts down", () => {
  expect(
    barLayer({
      phase: "starting",
      isCountingDown: true,
      screenRecording: "allowed",
      error: null,
      update: "available",
    }),
  ).toBe("countdown");
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
  const status = {
    phase,
    error: null,
    elapsedMs: 5000,
    microphoneRefused: false,
    countdown: null,
  };
  expect(elapsedMsAt(status, receivedAt, now)).toBe(elapsed);
});
