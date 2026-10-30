import { expect, test } from "bun:test";
import type { ExportState } from "@/lib/editor/export";
import { dockLayer, loopProgress, type DockLayer } from "./preview";

test.each<[string, ExportState, DockLayer]>([
  ["nothing running shows the actions", { stage: "idle" }, "actions"],
  [
    "a save in progress shows saving",
    { stage: "exporting", progress: 0.4, toClipboard: false },
    "saving",
  ],
  [
    "a copy in progress shows copying",
    { stage: "exporting", progress: 0.4, toClipboard: true },
    "copying",
  ],
  [
    "a finished save shows saved",
    { stage: "done", path: "/a.mp4", toClipboard: false },
    "saved",
  ],
  [
    "a finished copy shows copied",
    { stage: "done", path: "/a.mp4", toClipboard: true },
    "copied",
  ],
  ["a failure shows failed", { stage: "failed", reason: "no disk" }, "failed"],
])("dockLayer: %s", (_, state, layer) => {
  expect(dockLayer(state)).toBe(layer);
});

test.each([
  [1.5, 6000, 0.25],
  [7, 6000, 1],
  [3, 0, 0],
])(
  "loopProgress(%p, %p) is the share played, capped at the end, 0 before the length is known",
  (seconds, durationMs, progress) => {
    expect(loopProgress(seconds, durationMs)).toBe(progress);
  },
);
