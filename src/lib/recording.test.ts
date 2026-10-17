import { expect, test } from "bun:test";
import { centeredArea, choicesFor, targetFor, type Sources } from "./recording";

const sources: Sources = {
  displays: [{ id: 1, width: 1512, height: 982 }],
  windows: [{ id: 398, app: "Finder", title: "Desktop" }],
};

test("centeredArea should center 1280x720 on the display", () => {
  expect(centeredArea({ id: 1, width: 1512, height: 982 })).toEqual({
    x: 116,
    y: 131,
    width: 1280,
    height: 720,
  });
});

test("centeredArea should shrink to fit a small display", () => {
  expect(centeredArea({ id: 1, width: 1024, height: 640 }).width).toBe(1024);
});

test("choicesFor should list windows in window mode", () => {
  expect(choicesFor("window", sources)).toEqual([
    { id: 398, label: "Finder — Desktop" },
  ]);
});

test("targetFor should build a window target", () => {
  expect(targetFor("window", 398, sources)).toEqual({
    kind: "window",
    windowId: 398,
  });
});

test("targetFor should build a centered area target", () => {
  expect(targetFor("area", 1, sources)).toEqual({
    kind: "area",
    displayId: 1,
    x: 116,
    y: 131,
    width: 1280,
    height: 720,
  });
});

test("targetFor should be null for a display that is gone", () => {
  expect(targetFor("display", 99, sources)).toBeNull();
});
