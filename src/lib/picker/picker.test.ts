import { describe, expect, test } from "bun:test";
import type { Session } from "@/lib/bindings";
import type { Rect } from "@/lib/geometry";
import {
  captureBarPosition,
  centeredArea,
  dragArea,
  fitRatio,
  pixelSize,
  type Handle,
} from "./area";
import {
  holdsCursor,
  nextWindowId,
  pickerView,
  pointerOnDisplay,
  sameHighlight,
  sameView,
} from "./view";

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

describe("area", () => {
  const DISPLAY = { width: 1512, height: 982 };
  const BOX = rect(100, 100, 400, 300);

  test("centeredArea centers 1280x720, or fills a smaller display", () => {
    expect(centeredArea(DISPLAY)).toEqual(rect(116, 131, 1280, 720));
    const small = { width: 800, height: 600 };
    expect(centeredArea(small)).toEqual(rect(0, 0, 800, 600));
  });

  test.each<[Handle, number, number, Rect, string]>([
    ["move", 5000, -5000, rect(1112, 0, 400, 300), "stops at the edge"],
    ["move", 10.6, -0.4, rect(111, 100, 400, 300), "rounds to points"],
    ["n", 999, -40, rect(100, 60, 400, 340), "moves only the top"],
    ["s", 999, 40, rect(100, 100, 400, 340), "moves only the bottom"],
    ["e", 40, 999, rect(100, 100, 440, 300), "moves only the right"],
    ["w", -40, 999, rect(60, 100, 440, 300), "moves only the left"],
    ["ne", 20, -20, rect(100, 80, 420, 320), "moves the top and right"],
    ["sw", -20, 20, rect(80, 100, 420, 320), "moves the bottom and left"],
    ["se", 50, 5000, rect(100, 100, 450, 882), "stops at the display"],
    ["nw", -1000, -1000, rect(0, 0, 500, 400), "stops at the display"],
    ["nw", 1000, 1000, rect(450, 350, 50, 50), "keeps the minimum size"],
    ["e", -1000, 0, rect(100, 100, 50, 300), "keeps the minimum width"],
    ["s", 0, -1000, rect(100, 100, 400, 50), "keeps the minimum height"],
    ["w", 1000, 0, rect(450, 100, 50, 300), "keeps the minimum width"],
  ])("dragArea %p by (%p, %p) gives %o: %s", (handle, x, y, area) => {
    expect(dragArea(BOX, handle, { x, y }, DISPLAY)).toEqual(area);
  });

  test("drawing a new box pulls its corner from the press, at least the minimum size", () => {
    const press = rect(200, 200, 0, 0);
    const drawn = (x: number, y: number) =>
      dragArea(press, "se", { x, y }, DISPLAY);
    expect(drawn(300, 100)).toEqual(rect(200, 200, 300, 100));
    expect(drawn(-80, 3)).toEqual(rect(200, 200, 50, 50));
  });

  test("fitRatio keeps the center and about the same area, and comes back when switched back", () => {
    const box = rect(100, 100, 640, 360);
    const square = fitRatio(box, 1, DISPLAY);
    expect(square).toEqual(rect(180, 40, 480, 480));
    expect(fitRatio(square, 16 / 9, DISPLAY)).toEqual(box);
  });

  test("fitRatio caps a tall ratio to most of the display", () => {
    const portrait = fitRatio(centeredArea(DISPLAY), 9 / 16, DISPLAY);
    expect(portrait.height).toBe(Math.round(982 * 0.85));
    expect(portrait.width / portrait.height).toBeCloseTo(9 / 16, 2);
  });

  test("fitRatio keeps a box near the edge on screen", () => {
    const nearEdge = rect(0, 0, 640, 360);
    expect(fitRatio(nearEdge, 1, DISPLAY)).toEqual(rect(80, 0, 480, 480));
  });

  // Same cases as Rust's CaptureSize::of test.
  test.each([
    [920.5, 2, 1840],
    [333, 1.5, 498],
    [100, 1, 100],
    [982.5, 2, 1964],
  ])("pixelSize of %p points at %px is %p, even", (points, scale, pixels) => {
    const size = { width: points, height: points };
    expect(pixelSize(size, scale)).toEqual({ width: pixels, height: pixels });
  });

  test.each([
    [rect(100, 800, 400, 150), 140, 0, { x: 160, y: 648 }, "centered above"],
    [rect(0, 0, 1512, 982), 140, 0, { y: 12 }, "inside with no room above"],
    [rect(100, 60, 400, 300), 56, 38, { y: 72 }, "below the menu bar"],
    [rect(100, 0, 400, 300), 56, 38, { y: 50 }, "inside under the menu bar"],
    [rect(0, 500, 100, 100), 56, 0, { x: 12 }, "off the display's left"],
    [rect(1412, 500, 100, 100), 56, 0, { x: 1220 }, "off the right"],
  ])(
    "captureBarPosition for %o, a %p tall bar, safeTop %p, is %o: %s",
    (area, height, safeTop, at) => {
      const bar = { width: 280, height };
      expect(captureBarPosition(area, bar, DISPLAY, safeTop)).toMatchObject(at);
    },
  );
});

describe("pickerView", () => {
  const LAPTOP = {
    id: 1,
    name: "Built-in Display",
    frame: rect(0, 0, 1512, 982),
    size: { width: 3024, height: 1964 },
    scale: 2,
    safeTop: 38,
  };
  const MONITOR = {
    id: 2,
    name: "Studio Display",
    frame: rect(1512, 0, 1920, 1080),
    size: { width: 3840, height: 2160 },
    scale: 2,
    safeTop: 0,
  };
  const windowAt = (
    id: number,
    app: string,
    frame: Rect,
    displayId: number = LAPTOP.id,
  ) => ({
    id,
    pid: id * 10,
    app,
    frame,
    size: { width: frame.width * 2, height: frame.height * 2 },
    displayId,
  });
  const FRONT = windowAt(10, "Finder", rect(100, 100, 400, 300));
  const BACK = windowAt(11, "Safari", rect(0, 0, 1000, 800));
  const SPANNING = windowAt(12, "Notes", rect(1400, 500, 300, 200), MONITOR.id);
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
  const windows = session("window");
  const highlightAt = (
    from: Session,
    x: number,
    y: number,
    displayId = LAPTOP.id,
  ) => {
    const view = pickerView(from, { x, y }, displayId);
    return view?.mode === "area" ? undefined : view?.highlight;
  };

  test("display mode highlights only the display under the cursor, whole and in pixels", () => {
    expect(highlightAt(session("display"), 2000, 500, LAPTOP.id)).toBeNull();
    expect(
      highlightAt(session("display"), 2000, 500, MONITOR.id),
    ).toMatchObject({
      rect: rect(0, 0, 1920, 1080),
      covered: [],
      title: "Studio Display",
      icon: null,
      size: { width: 3840, height: 2160 },
      target: { kind: "display", displayId: 2 },
    });
  });

  test("window mode highlights the front window under the cursor, with its icon", () => {
    expect(highlightAt(windows, 150, 150)).toMatchObject({
      title: "Finder",
      size: { width: 800, height: 600 },
      icon: "data:image/png;base64,finder",
      covered: [],
    });
    expect(highlightAt(windows, 800, 700)?.icon).toBeNull();
    expect(highlightAt(windows, 1200, 900)).toBeNull();
  });

  test("window mode leaves out only the parts windows in front cover", () => {
    const partial = windowAt(13, "Mail", rect(900, 700, 300, 200));
    const stacked = session("window", {
      sources: {
        displays: [LAPTOP, MONITOR],
        windows: [FRONT, partial, BACK, SPANNING],
        icons: {},
      },
    });
    expect(highlightAt(stacked, 50, 50)).toMatchObject({
      title: "Safari",
      covered: [FRONT.frame, rect(900, 700, 100, 100)],
    });
  });

  test("window mode shows the capture bar only on the display with the cursor", () => {
    expect(highlightAt(windows, 1450, 550, LAPTOP.id)?.barRect).toEqual(
      rect(1400, 500, 112, 200),
    );
    expect(highlightAt(windows, 1450, 550, MONITOR.id)).toMatchObject({
      rect: rect(-112, 500, 300, 200),
      barRect: null,
    });
  });

  test("window mode prefers a pinned window, with its bar on the window's display, until it's gone", () => {
    const pinnedOn = (displayId: number) =>
      highlightAt(
        session("window", { pinnedWindowId: SPANNING.id }),
        150,
        150,
        displayId,
      );
    expect(pinnedOn(MONITOR.id)?.title).toBe("Notes");
    expect(pinnedOn(MONITOR.id)?.barRect).not.toBeNull();
    expect(pinnedOn(LAPTOP.id)?.barRect).toBeNull();
    expect(
      highlightAt(session("window", { pinnedWindowId: 404 }), 150, 150)?.title,
    ).toBe("Finder");
  });

  test("area mode puts the box only on the session's area display", () => {
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

  test("pickerView is null for a display the session doesn't know", () => {
    expect(pickerView(windows, { x: 10, y: 10 }, 99)).toBeNull();
  });

  test.each([
    [undefined, FRONT.id],
    [FRONT.id, BACK.id],
    [SPANNING.id, FRONT.id],
  ])(
    "nextWindowId cycles front to back and wraps: after %p comes %p",
    (current, next) => {
      expect(nextWindowId(WINDOWS, current)).toBe(next);
    },
  );

  test("nextWindowId gives nothing when there are no windows", () => {
    expect(nextWindowId([], undefined)).toBeUndefined();
  });

  test("sameHighlight and sameView ignore cursor moves that change nothing drawn", () => {
    expect(
      sameHighlight(
        highlightAt(windows, 150, 150)!,
        highlightAt(windows, 160, 170)!,
      ),
    ).toBe(true);
    expect(
      sameHighlight(
        highlightAt(windows, 150, 150)!,
        highlightAt(windows, 800, 700)!,
      ),
    ).toBe(false);
    const view = (from: Session, x: number, y: number) =>
      pickerView(from, { x, y }, LAPTOP.id);
    expect(sameView(view(windows, 150, 150), view(windows, 160, 170))).toBe(
      true,
    );
    expect(sameView(view(windows, 150, 150), view(windows, 800, 700))).toBe(
      false,
    );
    const area = session("area", { areaDisplayId: LAPTOP.id });
    expect(sameView(view(area, 1, 1), view(area, 900, 900))).toBe(true);
  });

  test("sameView sees a change of mode or box", () => {
    const area = session("area", { areaDisplayId: LAPTOP.id });
    const view = (from: Session) =>
      pickerView(from, { x: 10, y: 10 }, LAPTOP.id);
    expect(sameView(view(area), view(session("display")))).toBe(false);
    expect(
      sameView(view(area), view({ ...area, areaDisplayId: MONITOR.id })),
    ).toBe(false);
    expect(sameView(null, view(session("display")))).toBe(false);
    expect(sameView(null, null)).toBe(true);
  });

  test("holdsCursor picks exactly one display, so one overlay acts on Return and Tab", () => {
    const holding = (cursor: { x: number; y: number } | null) =>
      [LAPTOP, MONITOR]
        .filter((display) => holdsCursor(display, cursor))
        .map(({ id }) => id);
    expect(holding({ x: 1511, y: 10 })).toEqual([LAPTOP.id]);
    expect(holding({ x: 1512, y: 10 })).toEqual([MONITOR.id]);
    expect(holding(null)).toEqual([]);
  });

  test("pointerOnDisplay puts the cursor in the display's own coordinates", () => {
    const cursor = { x: 2000, y: 500 };
    expect(pointerOnDisplay(windows, cursor, MONITOR.id)).toEqual({
      x: 488,
      y: 500,
    });
    expect(pointerOnDisplay(null, cursor, MONITOR.id)).toBeNull();
    expect(pointerOnDisplay(windows, null, MONITOR.id)).toBeNull();
    expect(pointerOnDisplay(windows, cursor, 99)).toBeNull();
  });
});
