import { describe, expect, test } from "bun:test";
import { DEFAULT_APPEARANCE } from "./appearance";
import { outputAt, type Region, sourceAt } from "./regions";
import {
  changeAppearance,
  editRegions,
  frameAt,
  NEW_PROJECT,
  projectJson,
  PROJECT_VERSION,
  readProject,
} from "./project";
import { zoomTrack } from "./zoom";

describe("project", () => {
  test("changeAppearance and editRegions keep the same project when nothing changes", () => {
    expect(changeAppearance(NEW_PROJECT, { padding: 64 })).toBe(NEW_PROJECT);
    expect(
      changeAppearance(NEW_PROJECT, { padding: 80 }).appearance.padding,
    ).toBe(80);
    expect(editRegions(NEW_PROJECT, (regions) => regions)).toBe(NEW_PROJECT);
  });

  test("a saved project reads back the same, with its version", () => {
    const project = changeAppearance(NEW_PROJECT, { padding: 80 });
    expect(readProject(projectJson(project))).toEqual(project);
    expect(JSON.parse(projectJson(project)).version).toBe(PROJECT_VERSION);
  });

  test("no file starts a new project, and an older file fills what it lacks", () => {
    expect(readProject(null)).toBe(NEW_PROJECT);
    const light = readProject(
      JSON.stringify({ appearance: { borderColor: "light" } }),
    );
    expect(light.appearance.borderColor).toBe("#ffffff");
    const none = readProject(
      JSON.stringify({ appearance: { borderColor: "none" } }),
    );
    expect(none.appearance.borderColor).toBe(DEFAULT_APPEARANCE.borderColor);
    const removedType = readProject(
      JSON.stringify({
        regions: [{ id: 1, kind: "audio", startMs: 0, endMs: 1000, amount: 0 }],
      }),
    );
    expect(removedType.regions).toEqual([]);
    const older = readProject(JSON.stringify({ appearance: { padding: 12 } }));
    expect(older).toEqual({
      appearance: { ...DEFAULT_APPEARANCE, padding: 12 },
      regions: [],
      clips: [],
    });
  });
});

describe("frameAt", () => {
  const APPEARANCE = { ...DEFAULT_APPEARANCE, inset: 10, borderWidth: 4 };
  const at = (regions: Region[], outputMs: number, width = 1920 + 96) =>
    frameAt(
      {
        appearance: APPEARANCE,
        regions,
        canvas: { width, height: 2000 },
        ratio: 16 / 9,
      },
      outputMs,
    );
  const region = (
    kind: Region["kind"],
    startMs: number,
    endMs: number,
    amount: number,
  ) => ({ id: startMs, kind, startMs, endMs, amount }) satisfies Region;
  const zoomAt = (regions: Region[], ms: number) => at(regions, ms).zoom.scale;

  test("draws the appearance at its own sizes on a 1920 frame, and at half on a 960 one", () => {
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
    expect(track[0]).toEqual({ scale: 1, x: 0.5, y: 0.5 });
    expect(track[120]).toEqual({ scale: 1.5, x: 0.5, y: 0.5 });
    expect(track[240]).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });

  test("zooms on the middle unless the region has a center, and keeps it zooming out", () => {
    expect(at([], 0).zoom.center).toEqual({ x: 0.5, y: 0.5 });
    const center = { x: 0.2, y: 0.7 };
    const zoom = [{ ...region("zoom", 1000, 2000, 1.5), center }];
    expect(at(zoom, 500).zoom.center).toEqual({ x: 0.5, y: 0.5 });
    expect(at(zoom, 1500).zoom.center).toEqual(center);
    expect(at(zoom, 2300).zoom.center).toEqual(center);
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
