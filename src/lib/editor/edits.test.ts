import { describe, expect, test } from "bun:test";
import {
  aboutMegabytes,
  addRegion,
  amountAt,
  changeLook,
  dragRegion,
  clampAmount,
  DEFAULT_EXPORT,
  DEFAULT_LOOK,
  editRegions,
  exportLayout,
  exportOptions,
  fillCss,
  fillGradient,
  frameAt,
  frameLayout,
  NEW_PROJECT,
  regionKindForKey,
  removeRegion,
  removeRegionAt,
  rulerLabel,
  scaleLayout,
  outputAt,
  rulerMarks,
  sourceAt,
  zoomTrack,
  type Region,
  type RegionDrag,
} from "./edits";

describe("look", () => {
  test("changeLook and editRegions keep the same project when nothing changes", () => {
    expect(changeLook(NEW_PROJECT, { padding: 64 })).toBe(NEW_PROJECT);
    expect(changeLook(NEW_PROJECT, { padding: 80 }).look.padding).toBe(80);
    expect(editRegions(NEW_PROJECT, (regions) => regions)).toBe(NEW_PROJECT);
  });

  test("fillCss draws a gradient corner to corner, and a color as its middle stop", () => {
    expect(fillCss({ kind: "gradient", preset: 0 })).toBe(
      "linear-gradient(135deg, #0f4c5c 0%, #2a9d8f 55%, #e9c46a 100%)",
    );
    expect(fillCss({ kind: "color", preset: 2 })).toBe("#3b82f6");
  });

  test.each([
    ["padding", 200, 160],
    ["radius", -3, 0],
    ["shadowBlur", 47.6, 48],
  ] as const)(
    "clampAmount(%p, %p) keeps it in range, in whole steps",
    (amount, value, clamped) => {
      expect(clampAmount(amount, value)).toBe(clamped);
    },
  );

  test("frameLayout fits the frame inside the margin and scales the padding", () => {
    const { frame, recording, scale } = frameLayout(
      { ...DEFAULT_LOOK, padding: 192 },
      { width: 1056, height: 1000 },
      16 / 9,
    );
    expect(frame).toEqual({ width: 960, height: 540 });
    expect(scale).toBe(0.5);
    expect(recording.width).toBeCloseTo(618.67, 2);
    expect(recording.height).toBeCloseTo(348, 5);
  });

  test("frameLayout collapses to nothing on a canvas smaller than its margin", () => {
    const { frame, recording } = frameLayout(
      DEFAULT_LOOK,
      { width: 40, height: 40 },
      1,
    );
    expect(frame).toEqual({ width: 0, height: 0 });
    expect(recording).toEqual({ width: 0, height: 0 });
  });

  test("fillGradient makes a colour a gradient that doesn't change", () => {
    expect(fillGradient({ kind: "color", preset: 2 }).stops).toEqual([
      { color: "#3b82f6", at: 0 },
      { color: "#3b82f6", at: 1 },
    ]);
  });

  test("exportLayout keeps the recording at full size, centred in an even frame", () => {
    const layout = exportLayout(
      DEFAULT_LOOK,
      { width: 3840, height: 2278 },
      [],
    );
    expect([layout.width, layout.height]).toEqual([4326, 2566]);
    expect(layout.recording).toEqual({
      x: 243,
      y: 144,
      width: 3840,
      height: 2278,
    });
    expect(layout.radius).toBeCloseTo((20 * 4326) / 1920);
  });

  test("scaleLayout shrinks the whole export to a height, keeping its shape", () => {
    const full = exportLayout(DEFAULT_LOOK, { width: 3840, height: 2278 }, []);
    const small = scaleLayout(full, 1080);
    expect([small.width, small.height]).toEqual([1820, 1080]);
    expect(small.recording.width).toBeCloseTo((3840 * 1080) / 2566, 5);
    expect(small.radius).toBeCloseTo((full.radius * 1080) / 2566, 5);
  });

  test("aboutMegabytes estimates from the size, length and settings, to a tenth", () => {
    const full = exportLayout(DEFAULT_LOOK, { width: 1920, height: 1080 }, []);
    const hd = { ...full, width: 1920, height: 1080 };
    expect(aboutMegabytes(hd, 10_000, DEFAULT_EXPORT)).toBe(20.7);
    expect(
      aboutMegabytes(hd, 10_000, { ...DEFAULT_EXPORT, quality: "small" }),
    ).toBe(10.4);
    expect(
      aboutMegabytes(hd, 10_000, { ...DEFAULT_EXPORT, format: "gif" }),
    ).toBeNull();
  });

  test("exportOptions turns the settings into what Rust needs", () => {
    expect(
      exportOptions({ ...DEFAULT_EXPORT, format: "gif", to: "clipboard" }),
    ).toEqual({
      format: "gif",
      frameRate: 60,
      bitsPerPixel: 8,
      toClipboard: true,
    });
  });

  test("exportLayout pads a tall recording by its width, as the stage does", () => {
    const layout = exportLayout(
      DEFAULT_LOOK,
      { width: 1080, height: 1920 },
      [],
    );
    expect([layout.width % 2, layout.height % 2]).toEqual([0, 0]);
    expect(layout.recording.x).toBe(Math.round((layout.width - 1080) / 2));
    expect(layout.recording.x).toBeCloseTo((64 * layout.width) / 1920, 0);
  });
});

describe("regions", () => {
  const ZOOM_1_TO_3: Region = {
    id: 1,
    kind: "zoom",
    startMs: 1000,
    endMs: 3000,
    amount: 1.5,
  };
  const spans = (regions: Region[]) =>
    regions.map(({ startMs, endMs }) => `${startMs}-${endMs}`).join(" ");

  test("addRegion adds two seconds of the kind's amount at the playhead", () => {
    expect(addRegion([], "speed", 500, 10_000)[0]).toMatchObject({
      kind: "speed",
      startMs: 500,
      endMs: 2500,
      amount: 2,
    });
  });

  test.each([
    [0, "0-1000 1000-3000", "stops at the next region"],
    [3000, "1000-3000 3000-5000", "starts where the one before ends"],
    [9000, "1000-3000 9000-10000", "stops at the end"],
    [9750, "1000-3000 9750-10000", "fits a quarter second at the end"],
    [9800, "1000-3000", "adds nothing shorter than a quarter second"],
    [1500, "1000-3000", "adds nothing inside a region, of either kind"],
    [900, "1000-3000", "adds nothing without room before the next region"],
  ])("addRegion at %p gives %p: %s", (atMs, expected) => {
    expect(spans(addRegion([ZOOM_1_TO_3], "speed", atMs, 10_000))).toBe(
      expected,
    );
  });

  test("addRegion keeps regions in time order", () => {
    const both = addRegion(
      addRegion([], "zoom", 6000, 10_000),
      "speed",
      0,
      10_000,
    );
    expect(both.map((region) => region.kind)).toEqual(["speed", "zoom"]);
  });

  test("a region added after a removal gets an id no other region has", () => {
    const two = addRegion([ZOOM_1_TO_3], "speed", 5000, 10_000);
    const added = addRegion(
      two.filter(({ id }) => id !== 1),
      "zoom",
      0,
      10_000,
    );
    const ids = added.map((region) => region.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  const ZOOM_5_TO_6: Region = {
    ...ZOOM_1_TO_3,
    id: 2,
    startMs: 5000,
    endMs: 6000,
  };
  const drag = (edge: RegionDrag, deltaMs: number) =>
    spans(dragRegion([ZOOM_1_TO_3, ZOOM_5_TO_6], 1, edge, deltaMs, 10_000));

  test.each([
    ["move", 500, "1500-3500 5000-6000", "moves the whole region"],
    ["move", 5000, "3000-5000 5000-6000", "stops at the next region"],
    ["move", -5000, "0-2000 5000-6000", "stops at the start"],
    ["start", -400, "600-3000 5000-6000", "moves just the start"],
    ["start", 5000, "2750-3000 5000-6000", "keeps a quarter second"],
    ["end", 9000, "1000-5000 5000-6000", "stops the end at the next region"],
  ] as const)("dragRegion %p by %p gives %p: %s", (edge, deltaMs, expected) => {
    expect(drag(edge, deltaMs)).toBe(expected);
  });

  test("dragRegion past the last region stops at the end", () => {
    expect(spans(dragRegion([ZOOM_5_TO_6], 2, "end", 9000, 8000))).toBe(
      "5000-8000",
    );
  });

  test("a drag that changes nothing, or a removal of nothing, returns the same regions", () => {
    const regions = [ZOOM_1_TO_3];
    expect(dragRegion(regions, 1, "move", 0, 10_000)).toBe(regions);
    expect(dragRegion(regions, 9, "move", 500, 10_000)).toBe(regions);
    expect(removeRegion(regions, 9)).toBe(regions);
    expect(removeRegion(regions, 1)).toEqual([]);
  });

  test("removeRegionAt removes the region under the playhead, and nothing elsewhere", () => {
    expect(removeRegionAt([ZOOM_1_TO_3], 2999)).toEqual([]);
    expect(removeRegionAt([ZOOM_1_TO_3], 3000)).toEqual([ZOOM_1_TO_3]);
  });

  test.each([
    ["zoom", 1500, 1.5],
    ["zoom", 3000, 1],
    ["speed", 1500, 1],
  ] as const)(
    "amountAt(%p, %p) is the region's amount inside it and 1 outside",
    (kind, ms, amount) => {
      expect(amountAt([ZOOM_1_TO_3], kind, ms)).toBe(amount);
    },
  );

  test.each([
    ["z", "zoom"],
    ["S", "speed"],
    ["x", undefined],
  ] as const)("regionKindForKey(%p) matches in either case", (key, kind) => {
    expect(regionKindForKey(key)).toBe(kind);
  });

  const labelled = (durationMs: number) =>
    rulerMarks(durationMs)
      .filter((mark) => mark.isMajor)
      .map((mark) => mark.ms);

  test("rulerMarks labels every two seconds of a 15 second clip, with a short mark between", () => {
    expect(labelled(15_000)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000,
    ]);
    expect(rulerMarks(15_000)[1]).toEqual({ ms: 1000, isMajor: false });
  });

  test("rulerMarks labels every second of a ten second clip, end included", () => {
    expect(labelled(10_000)).toHaveLength(11);
    const marks = rulerMarks(10_000);
    expect(marks[marks.length - 1]).toEqual({ ms: 10_000, isMajor: true });
  });

  test("rulerMarks gives a single mark for an empty clip", () => {
    expect(rulerMarks(0)).toEqual([{ ms: 0, isMajor: true }]);
  });

  test("rulerMarks falls back to ten-minute labels for very long clips", () => {
    const [first, second] = labelled(3 * 60 * 60 * 1000);
    expect(second - first).toBe(600_000);
  });

  test.each([
    [4000, "0:04"],
    [75_000, "1:15"],
    [1400, "0:01"],
    [59_600, "1:00"],
  ])("rulerLabel(%p) rounds to the nearest second: %p", (ms, label) => {
    expect(rulerLabel(ms)).toBe(label);
  });
});

describe("frameAt", () => {
  const LOOK = { ...DEFAULT_LOOK, inset: 10, borderWidth: 4 };
  const at = (regions: Region[], outputMs: number, width = 1920 + 96) =>
    frameAt(
      { look: LOOK, regions, canvas: { width, height: 2000 }, ratio: 16 / 9 },
      outputMs,
    );
  const region = (
    kind: Region["kind"],
    startMs: number,
    endMs: number,
    amount: number,
  ) => ({ id: startMs, kind, startMs, endMs, amount }) satisfies Region;
  const zoomAt = (regions: Region[], ms: number) => at(regions, ms).zoom.scale;

  test("draws the look at its own sizes on a 1920 frame, and at half on a 960 one", () => {
    const full = at([], 0);
    expect(full.frame.width).toBe(1920);
    expect(full).toMatchObject({
      radius: 20,
      shadow: { offsetY: 16, blur: 48, color: "rgb(0 0 0 / 0.4)" },
      border: { width: 4 },
      video: { x: -10, y: -10, width: full.recording.width + 20 },
    });
    const half = at([], 0, 960 + 96);
    expect(half).toMatchObject({
      radius: 10,
      shadow: { offsetY: 8, blur: 24 },
    });
    expect(half.border.width).toBe(2);
    expect(half.recording.width).toBeCloseTo(full.recording.width / 2, 5);
  });

  test("eases a zoom in from its start and back out from its end", () => {
    const zoom = [region("zoom", 1000, 3000, 1.5)];
    expect(zoomAt(zoom, 999)).toBe(1);
    expect(zoomAt(zoom, 1000)).toBeCloseTo(1, 5);
    expect(zoomAt(zoom, 1300)).toBeGreaterThan(1.4);
    expect(zoomAt(zoom, 1600)).toBe(1.5);
    expect(zoomAt(zoom, 3000)).toBeCloseTo(1.5, 5);
    expect(zoomAt(zoom, 3300)).toBeLessThan(1.1);
    expect(zoomAt(zoom, 3600)).toBe(1);
    expect(at(zoom, 1001).zoom.target).toBe(1.5);
  });

  test("a short zoom eases back out from wherever it got to", () => {
    const short = [region("zoom", 1000, 1250, 1.5)];
    const reached = zoomAt(short, 1250);
    expect(reached).toBeGreaterThan(1);
    expect(reached).toBeLessThan(1.5);
    expect(zoomAt(short, 1260)).toBeLessThan(reached);
    expect(zoomAt(short, 1850)).toBe(1);
  });

  test("back-to-back zooms ease from one amount straight to the next", () => {
    const both = [
      region("zoom", 1000, 2000, 1.5),
      region("zoom", 2000, 3000, 2),
    ];
    expect(zoomAt(both, 2000)).toBeCloseTo(1.5, 5);
    expect(zoomAt(both, 2100)).toBeGreaterThan(1.5);
    expect(zoomAt(both, 2600)).toBe(2);
  });

  test("a zoom inside a fast region eases over the same output time", () => {
    const regions = [
      region("speed", 0, 4000, 2),
      region("zoom", 1000, 3000, 1.5),
    ];
    expect(zoomAt(regions, 500)).toBeCloseTo(1, 5);
    expect(zoomAt(regions, 1099)).toBeLessThan(1.5);
    expect(zoomAt(regions, 1100)).toBe(1.5);
  });

  test("zoomTrack gives the zoom at every 60th of a second, end included", () => {
    const track = zoomTrack([region("zoom", 1000, 3000, 1.5)], 4000);
    expect(track).toHaveLength(241);
    expect(track[0]).toBe(1);
    expect(track[120]).toBe(1.5);
    expect(track[240]).toBe(1);
  });

  test("zooms on the middle unless the region has a centre, and keeps it zooming out", () => {
    expect(at([], 0).zoom.centre).toEqual({ x: 0.5, y: 0.5 });
    const centre = { x: 0.2, y: 0.7 };
    const zoom = [{ ...region("zoom", 1000, 2000, 1.5), centre }];
    expect(at(zoom, 500).zoom.centre).toEqual({ x: 0.5, y: 0.5 });
    expect(at(zoom, 1500).zoom.centre).toEqual(centre);
    expect(at(zoom, 2300).zoom.centre).toEqual(centre);
  });

  test.each([
    [1000, 1000, "before both, they're in step"],
    [1500, 2000, "a 2× region plays its 1000ms in 500"],
    [2500, 2500, "a ½× region then plays its 1000ms in 2000"],
    [3500, 3000, "so it ends 500ms later than the source"],
    [4500, 4000, "and they stay 500ms apart after"],
  ])(
    "with back-to-back speed regions, output %p shows source %p: %s",
    (outputMs, sourceMs) => {
      const regions: Region[] = [
        region("speed", 1000, 2000, 2),
        region("speed", 2000, 3000, 0.5),
      ];
      expect(at(regions, outputMs).sourceMs).toBeCloseTo(sourceMs, 5);
      expect(sourceAt(regions, outputAt(regions, sourceMs))).toBeCloseTo(
        sourceMs,
        5,
      );
    },
  );
});
