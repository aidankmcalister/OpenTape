import { expect, test } from "bun:test";
import type { Point } from "./geometry";
import type { Setup } from "./picker";
import { nextWindowId, pickerView, type Focus } from "./pickerView";

const LAPTOP = {
  id: 1,
  name: "Built-in Display",
  frame: { x: 0, y: 0, width: 1512, height: 982 },
};
const MONITOR = {
  id: 2,
  name: "Studio Display",
  frame: { x: 1512, y: 0, width: 1920, height: 1080 },
};
const FRONT = {
  id: 10,
  pid: 100,
  app: "Finder",
  title: "Desktop",
  frame: { x: 100, y: 100, width: 400, height: 300 },
};
const BACK = {
  id: 11,
  pid: 101,
  app: "Safari",
  title: "Docs",
  frame: { x: 0, y: 0, width: 1000, height: 800 },
};
const SPANNING = {
  id: 12,
  pid: 102,
  app: "Notes",
  title: "",
  frame: { x: 1400, y: 500, width: 300, height: 200 },
};
const WINDOWS = [FRONT, BACK, SPANNING];

function setup(mode: Setup["mode"], cursor: Point | null = null): Setup {
  return {
    mode,
    cursor,
    sources: {
      displays: [LAPTOP, MONITOR],
      windows: WINDOWS,
      icons: { 100: "data:image/png;base64,finder" },
    },
  };
}

const at = (cursor: Point): Focus => ({ cursor, pinnedWindowId: null });

test("display mode should highlight only the display under the cursor", () => {
  const focus = at({ x: 2000, y: 500 });
  expect(pickerView(setup("display"), focus, LAPTOP.id)).toEqual({
    mode: "display",
    highlight: null,
    hasCursor: false,
  });
  const view = pickerView(setup("display"), focus, MONITOR.id);
  expect(view?.mode === "display" && view.highlight?.target).toEqual({
    kind: "display",
    displayId: 2,
  });
});

test("window mode should highlight the front window under the cursor", () => {
  const view = pickerView(setup("window"), at({ x: 150, y: 150 }), LAPTOP.id);
  expect(view?.mode === "window" && view.highlight?.title).toBe("Finder");
});

test("window mode should show the pill only on the display with the cursor", () => {
  const focus = at({ x: 1450, y: 550 });
  const here = pickerView(setup("window"), focus, LAPTOP.id);
  const there = pickerView(setup("window"), focus, MONITOR.id);
  expect(here?.mode === "window" && here.highlight?.label).toEqual({
    x: 1400,
    y: 500,
    width: 112,
    height: 200,
  });
  expect(there?.mode === "window" && there.highlight?.rect).toEqual({
    x: -112,
    y: 500,
    width: 300,
    height: 200,
  });
  expect(there?.mode === "window" && there.highlight?.label).toBeNull();
});

test("window mode should prefer a pinned window and label it where its center is", () => {
  const focus = { cursor: { x: 150, y: 150 }, pinnedWindowId: SPANNING.id };
  const view = pickerView(setup("window"), focus, MONITOR.id);
  expect(view?.mode === "window" && view.highlight?.title).toBe("Notes");
  expect(view?.mode === "window" && view.highlight?.label).not.toBeNull();
});

test("nextWindowId should cycle front to back and wrap around", () => {
  expect(nextWindowId(WINDOWS, undefined)).toBe(FRONT.id);
  expect(nextWindowId(WINDOWS, FRONT.id)).toBe(BACK.id);
  expect(nextWindowId(WINDOWS, SPANNING.id)).toBe(FRONT.id);
});

test("area mode should start the box on the display under the opening cursor", () => {
  const opened = setup("area", { x: 2000, y: 100 });
  expect(pickerView(opened, at({ x: 0, y: 0 }), MONITOR.id)).toMatchObject({
    mode: "area",
    startsHere: true,
  });
  expect(pickerView(opened, at({ x: 0, y: 0 }), LAPTOP.id)).toMatchObject({
    mode: "area",
    startsHere: false,
  });
});

test("window mode should carry the app's icon", () => {
  const view = pickerView(setup("window"), at({ x: 150, y: 150 }), LAPTOP.id);
  expect(view?.mode === "window" && view.highlight?.icon).toBe(
    "data:image/png;base64,finder",
  );
});
