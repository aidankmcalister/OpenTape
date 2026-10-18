import { expect, test } from "bun:test";
import type { Session } from "@/lib/bindings/Session";
import { nextWindowId, pickerView, sameHighlight } from "./pickerView";

const LAPTOP = {
  id: 1,
  name: "Built-in Display",
  frame: { x: 0, y: 0, width: 1512, height: 982 },
  size: { width: 3024, height: 1964 },
  safeTop: 38,
};
const MONITOR = {
  id: 2,
  name: "Studio Display",
  frame: { x: 1512, y: 0, width: 1920, height: 1080 },
  size: { width: 3840, height: 2160 },
  safeTop: 0,
};
const FRONT = {
  id: 10,
  pid: 100,
  app: "Finder",
  frame: { x: 100, y: 100, width: 400, height: 300 },
  size: { width: 800, height: 600 },
};
const BACK = {
  id: 11,
  pid: 101,
  app: "Safari",
  frame: { x: 0, y: 0, width: 1000, height: 800 },
  size: { width: 2000, height: 1600 },
};
const SPANNING = {
  id: 12,
  pid: 102,
  app: "Notes",
  frame: { x: 1400, y: 500, width: 300, height: 200 },
  size: { width: 600, height: 400 },
};
const WINDOWS = [FRONT, BACK, SPANNING];

function session(
  mode: Session["mode"],
  changes: Partial<Session> = {},
): Session {
  return {
    mode,
    sources: {
      displays: [LAPTOP, MONITOR],
      windows: WINDOWS,
      icons: { 100: "data:image/png;base64,finder" },
    },
    pinnedWindowId: null,
    areaDisplayId: null,
    ...changes,
  };
}

test("display mode should highlight only the display under the cursor", () => {
  const cursor = { x: 2000, y: 500 };
  expect(pickerView(session("display"), cursor, LAPTOP.id)).toEqual({
    mode: "display",
    highlight: null,
  });
  const view = pickerView(session("display"), cursor, MONITOR.id);
  expect(view?.mode === "display" && view.highlight?.target).toEqual({
    kind: "display",
    displayId: 2,
  });
});

test("window mode should highlight the front window under the cursor", () => {
  const view = pickerView(session("window"), { x: 150, y: 150 }, LAPTOP.id);
  expect(view?.mode === "window" && view.highlight?.title).toBe("Finder");
  expect(view?.mode === "window" && view.highlight?.size).toEqual({
    width: 800,
    height: 600,
  });
});

test("window mode should leave out the parts windows in front cover", () => {
  const view = pickerView(session("window"), { x: 800, y: 700 }, LAPTOP.id);
  expect(view?.mode === "window" && view.highlight?.title).toBe("Safari");
  expect(view?.mode === "window" && view.highlight?.covered).toEqual([
    FRONT.frame,
  ]);
});

test("window mode should show the pill only on the display with the cursor", () => {
  const cursor = { x: 1450, y: 550 };
  const here = pickerView(session("window"), cursor, LAPTOP.id);
  const there = pickerView(session("window"), cursor, MONITOR.id);
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
  const pinned = session("window", { pinnedWindowId: SPANNING.id });
  const view = pickerView(pinned, { x: 150, y: 150 }, MONITOR.id);
  expect(view?.mode === "window" && view.highlight?.title).toBe("Notes");
  expect(view?.mode === "window" && view.highlight?.label).not.toBeNull();
});

test("window mode should carry the app's icon", () => {
  const view = pickerView(session("window"), { x: 150, y: 150 }, LAPTOP.id);
  expect(view?.mode === "window" && view.highlight?.icon).toBe(
    "data:image/png;base64,finder",
  );
});

test("nextWindowId should cycle front to back and wrap around", () => {
  expect(nextWindowId(WINDOWS, undefined)).toBe(FRONT.id);
  expect(nextWindowId(WINDOWS, FRONT.id)).toBe(BACK.id);
  expect(nextWindowId(WINDOWS, SPANNING.id)).toBe(FRONT.id);
});

test("area mode should put the box only on the session's area display", () => {
  const area = session("area", { areaDisplayId: MONITOR.id });
  expect(pickerView(area, null, MONITOR.id)).toMatchObject({
    mode: "area",
    hasBox: true,
  });
  expect(pickerView(area, null, LAPTOP.id)).toMatchObject({
    mode: "area",
    hasBox: false,
  });
});

test("sameHighlight should ignore cursor moves within one window", () => {
  const highlightAt = (x: number, y: number) => {
    const view = pickerView(session("window"), { x, y }, LAPTOP.id);
    return view?.mode === "window" ? view.highlight : null;
  };
  expect(sameHighlight(highlightAt(150, 150), highlightAt(160, 170))).toBe(
    true,
  );
  expect(sameHighlight(highlightAt(150, 150), highlightAt(800, 700))).toBe(
    false,
  );
});
