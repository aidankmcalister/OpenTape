import { expect, test } from "bun:test";
import type { UpdateStatus } from "@/lib/bindings";
import { downloadProgress, newsOf, whatIsNew } from "./update";
import type { News } from "./update";

test.each<[UpdateStatus, News | null]>([
  [{ state: "upToDate" }, null],
  [{ state: "checking" }, null],
  [{ state: "available", version: "0.2.0", notes: "" }, "available"],
  [
    { state: "downloading", version: "0.2.0", downloaded: 0, total: 0 },
    "downloading",
  ],
  [{ state: "ready", version: "0.2.0" }, "ready"],
  [{ state: "failed", version: "0.2.0" }, "failed"],
  [{ state: "failed", version: null }, null],
])("newsOf(%p) is %p", (status, expected) => {
  expect(newsOf(status)).toBe(expected);
});

test("downloadProgress gives the percent and megabytes", () => {
  expect(
    downloadProgress({
      state: "downloading",
      version: "0.2.0",
      downloaded: 18_000_000,
      total: 43_000_000,
    }),
  ).toEqual({ percent: 42, detail: "18 of 43 MB" });
});

test("downloadProgress starts at zero before the size is known", () => {
  expect(
    downloadProgress({
      state: "downloading",
      version: "0.2.0",
      downloaded: 0,
      total: 0,
    })?.percent,
  ).toBe(0);
  expect(downloadProgress({ state: "ready", version: "0.2.0" })).toBeNull();
});

test("whatIsNew keeps only the bullet lines of the release notes", () => {
  const notes =
    "## What's new\n- Click effects in the Cursor panel\n* Faster export\nThanks!";
  expect(whatIsNew(notes)).toEqual([
    "Click effects in the Cursor panel",
    "Faster export",
  ]);
});
