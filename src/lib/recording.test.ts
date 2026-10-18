import { expect, test } from "bun:test";
import { exportName, recordingName } from "./recording";

test("recordingName should read the recording's start time from its folder", () => {
  const start = new Date(2026, 9, 16, 7, 41, 28);
  const path = `/data/recordings/recording-${start.getTime() / 1000}/recording.mov`;
  expect(recordingName(path)).toBe("2026-10-16 07.41.28");
});

test("recordingName should fall back when the folder has no time", () => {
  expect(recordingName("/tmp/clip.mov")).toBe("Untitled recording");
});

test("exportName should read like macOS's own screen recordings", () => {
  const start = new Date(2026, 9, 16, 7, 41, 28);
  const path = `/data/recordings/recording-${start.getTime() / 1000}/recording.mov`;
  expect(exportName(path)).toBe("Screen Recording 2026-10-16 at 07.41.28");
});
