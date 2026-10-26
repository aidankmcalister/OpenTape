import { describe, expect, test } from "bun:test";
import type { Region } from "./regions";
import { DEFAULT_APPEARANCE, frameLayout } from "./appearance";
import {
  aboutMegabytes,
  DEFAULT_EXPORT,
  exportLayout,
  exportOptions,
  readExport,
} from "./export";

describe("export", () => {
  test("exportLayout keeps the recording at full size, centered in an even frame", () => {
    const layout = exportLayout(DEFAULT_APPEARANCE, {
      width: 3840,
      height: 2278,
    });
    expect([layout.width, layout.height]).toEqual([4326, 2566]);
    expect(layout.recording).toEqual({
      x: 243,
      y: 144,
      width: 3840,
      height: 2278,
    });
    expect(layout.radius).toBeCloseTo((20 * 4326) / 1920);
  });

  test("exportLayout shrinks the whole export to a height, keeping its shape", () => {
    const full = exportLayout(DEFAULT_APPEARANCE, {
      width: 3840,
      height: 2278,
    });
    const small = exportLayout(
      DEFAULT_APPEARANCE,
      { width: 3840, height: 2278 },
      {},
      1080,
    );
    expect([small.width, small.height]).toEqual([1820, 1080]);
    expect(small.recording.width).toBeCloseTo((3840 * 1080) / full.height, 0);
    expect(small.radius).toBeCloseTo((full.radius * 1080) / full.height, 0);
  });

  test("exportLayout letterboxes the recording at full size in a chosen shape", () => {
    const layout = exportLayout(
      { ...DEFAULT_APPEARANCE, size: "9:16" },
      { width: 1920, height: 1080 },
    );
    expect([layout.width, layout.height]).toEqual([2058, 3658]);
    expect(layout.recording).toEqual({
      x: 69,
      y: 1289,
      width: 1920,
      height: 1080,
    });
    expect(layout.recording.x).toBeCloseTo((64 * layout.width) / 1920, 0);
  });

  test("exportLayout sets the short side of a chosen shape, and the height in Auto", () => {
    const video = { width: 1920, height: 1080 };
    const at = (size: "9:16" | "1:1" | "Auto") =>
      exportLayout({ ...DEFAULT_APPEARANCE, size }, video, {}, 1080);
    expect([at("9:16").width, at("9:16").height]).toEqual([1080, 1920]);
    expect([at("1:1").width, at("1:1").height]).toEqual([1080, 1080]);
    expect(at("Auto").height).toBe(1080);
  });

  test("aboutMegabytes estimates from the size, length and settings, to a tenth", () => {
    const full = exportLayout(DEFAULT_APPEARANCE, {
      width: 1920,
      height: 1080,
    });
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
    const layout = exportLayout(DEFAULT_APPEARANCE, {
      width: 1080,
      height: 1920,
    });
    expect([layout.width % 2, layout.height % 2]).toEqual([0, 0]);
    expect(layout.recording.x).toBe(Math.round((layout.width - 1080) / 2));
    expect(layout.recording.x).toBeCloseTo((64 * layout.width) / 1920, 0);
  });
});

test("exportLayout grows the video by the inset, and draws a border only with a width", () => {
  const appearance = { ...DEFAULT_APPEARANCE, inset: 10 };
  const plain = exportLayout(appearance, { width: 1920, height: 1080 });
  const scale = plain.width / 1920;
  expect(plain.video.x).toBeCloseTo(plain.recording.x - 10 * scale, 5);
  expect(plain.video.width).toBeCloseTo(1920 + 20 * scale, 5);
  expect(plain.border).toBeNull();
  const bordered = exportLayout(
    {
      ...appearance,
      borderWidth: 4,
      borderColor: "#3d9bff",
      borderOpacity: 60,
    },
    { width: 1920, height: 1080 },
  );
  expect(bordered.border).toEqual({
    color: "#3d9bff",
    opacity: 0.6,
    width: 4 * scale,
  });
});

test("exportLayout sends the zoom track, and each speed region in seconds", () => {
  const regions: Region[] = [
    { id: 1, kind: "zoom", startMs: 0, endMs: 1000, amount: 1.5 },
    { id: 2, kind: "speed", startMs: 2000, endMs: 3500, amount: 2 },
  ];
  const layout = exportLayout(
    DEFAULT_APPEARANCE,
    { width: 1920, height: 1080 },
    { regions, durationMs: 4000 },
  );
  expect(layout.zoom).toHaveLength(241);
  expect(layout.speed).toEqual([{ start: 2, end: 3.5, amount: 2 }]);
});

test("exportLayout sends each cut in seconds of the sped-up video", () => {
  const regions: Region[] = [
    { id: 1, kind: "speed", startMs: 0, endMs: 2000, amount: 2 },
  ];
  const clips = [
    { id: 1, startMs: 0, endMs: 3000 },
    { id: 2, startMs: 4000, endMs: 6000 },
  ];
  const layout = exportLayout(
    DEFAULT_APPEARANCE,
    { width: 1920, height: 1080 },
    { regions, durationMs: 6000, clips },
  );
  expect(layout.cuts).toEqual([{ start: 2, end: 3 }]);
});

test("exportLayout sends each click ring at its output time, sized for the export", () => {
  const regions: Region[] = [
    { id: 1, kind: "speed", startMs: 0, endMs: 2000, amount: 2 },
  ];
  const ring = {
    ms: 3000,
    x: 0.5,
    y: 0.5,
    color: "#ffffff",
    size: 48,
    style: "ring" as const,
  };
  const layout = exportLayout(
    DEFAULT_APPEARANCE,
    { width: 3840, height: 2160 },
    { regions, durationMs: 4000, rings: [ring] },
  );
  const scale = layout.width / 1920;
  expect(layout.rings).toEqual([
    { t: 2, x: 0.5, y: 0.5, color: "#ffffff", size: 48 * scale, style: "ring" },
  ]);
  const half = exportLayout(
    DEFAULT_APPEARANCE,
    { width: 3840, height: 2160 },
    { regions, durationMs: 4000, rings: [ring] },
    layout.height / 2,
  );
  expect(half.rings[0].size).toBeCloseTo(24 * scale, 0);
});

test.each([
  ["Auto", 1920, 1080, 64],
  ["Auto", 1080, 1920, 64],
  ["9:16", 3550, 1446, 120],
  ["1:1", 1280, 720, 0],
  ["4:5", 1920, 1200, 200],
] as const)(
  "the export frames a %s %ix%i recording with padding %i exactly as the stage does",
  (size, width, height, padding) => {
    const appearance = { ...DEFAULT_APPEARANCE, size, padding };
    const layout = exportLayout(appearance, { width, height });
    const stage = frameLayout(
      appearance,
      { width: 1600, height: 1000 },
      width / height,
    );
    const share = (part: number, whole: number) => part / whole;
    expect(share(layout.width, layout.height)).toBeCloseTo(
      share(stage.frame.width, stage.frame.height),
      2,
    );
    expect(share(layout.recording.width, layout.width)).toBeCloseTo(
      share(stage.recording.width, stage.frame.width),
      2,
    );
    expect(share(layout.recording.height, layout.height)).toBeCloseTo(
      share(stage.recording.height, stage.frame.height),
      2,
    );
  },
);

test("readExport keeps known choices and falls back for missing or unknown ones", () => {
  expect(readExport(null)).toEqual(DEFAULT_EXPORT);
  expect(readExport({ format: "gif", frameRate: 30, to: "clipboard" })).toEqual(
    {
      ...DEFAULT_EXPORT,
      format: "gif",
      frameRate: 30,
      to: "clipboard",
    },
  );
  expect(
    readExport({ resolution: "8K", quality: "huge", frameRate: 24 }),
  ).toEqual(DEFAULT_EXPORT);
});
