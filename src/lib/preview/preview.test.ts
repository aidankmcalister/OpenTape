import { expect, test } from "bun:test";
import {
  IDLE_ACTIVITY,
  loopProgress,
  nextActivity,
  SHOWS_FOR_MS,
  type Activity,
  type ActivityEvent,
} from "./preview";

const run = (events: ActivityEvent[]) =>
  events.reduce(nextActivity, IDLE_ACTIVITY);
const save = { type: "start", job: "save" } as const;
const saved = { type: "succeed", job: "save" } as const;
const copy = { type: "start", job: "copy" } as const;
const copied = { type: "succeed", job: "copy" } as const;
const fail = { type: "fail", error: "no disk" } as const;
const expire = { type: "expire" } as const;
const reset = { type: "reset" } as const;

test.each<[string, ActivityEvent[], Activity]>([
  ["a save shows saving", [save], "saving"],
  ["then saved", [save, saved], "saved"],
  ["a copy shows copying", [copy], "copying"],
  ["then copied", [copy, copied], "copied"],
  ["a failure shows failed", [save, fail], "failed"],
  ["a saved result expires to idle", [save, saved, expire], "idle"],
  ["a copied result expires to idle", [copy, copied, expire], "idle"],
  ["a failure expires to idle", [copy, fail, expire], "idle"],
  ["expiring mid-job leaves it running", [save, expire], "saving"],
  [
    "a new save replaces a result still showing",
    [copy, copied, save],
    "saving",
  ],
  ["another recording returns to idle, even mid-job", [save, reset], "idle"],
])("nextActivity: %s", (_, events, activity) => {
  expect(run(events).activity).toBe(activity);
});

test("a failure keeps why, and a later success keeps the last reason", () => {
  expect(run([save, fail])).toEqual({ activity: "failed", failure: "no disk" });
  expect(run([fail, save, saved])).toEqual({
    activity: "saved",
    failure: "no disk",
  });
});

test("expiring changes nothing while busy or idle", () => {
  const saving = run([save]);
  expect(nextActivity(saving, expire)).toBe(saving);
  expect(nextActivity(IDLE_ACTIVITY, expire)).toBe(IDLE_ACTIVITY);
});

test("a failure shows longest, then saved, then copied; busy and idle stay", () => {
  expect(SHOWS_FOR_MS).toEqual({ failed: 5000, saved: 4000, copied: 2000 });
});

test.each([
  [1.5, 6000, 0.25],
  [7, 6000, 1],
  [3, null, 0],
])(
  "loopProgress(%p, %p) is the share played, capped at the end, 0 before the length is known",
  (seconds, durationMs, progress) => {
    expect(loopProgress(seconds, durationMs)).toBe(progress);
  },
);
