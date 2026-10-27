import { expect, test } from "bun:test";
import {
  cursorPath,
  cursorPictures,
  cursorUnit,
  plainOr,
  exportCursor,
  readCursor,
  ringCircles,
  ringEvents,
  ringsAt,
  type CursorClick,
  visibleBox,
  steadySpots,
  suggestedSpeeds,
  suggestedZooms,
} from "./cursor";
import { type CursorSettings, DEFAULT_CURSOR } from "./appearance";
import type { Region } from "./regions";

const META = JSON.stringify({
  first_frame_time: 100,
  screen_rect: { x: 0, y: 40, width: 2000, height: 1000 },
  pauses: [[103, 105]],
});

const EVENTS = [
  '{"type":"move","t":100.5,"x":10,"y":50}',
  '{"type":"down","t":99,"x":10,"y":50,"button":"left"}',
  '{"type":"down","t":101,"x":500,"y":540,"button":"left"}',
  '{"type":"up","t":101.1,"x":500,"y":540,"button":"left"}',
  '{"type":"down","t":104,"x":1000,"y":540,"button":"left"}',
  '{"type":"down","t":106,"x":1500,"y":290,"button":"right"}',
].join("\n");

test("clicks land in video time and video space, skipping pauses and anything before the first frame", () => {
  expect(readCursor(META, EVENTS).clicks).toEqual([
    { ms: 1000, x: 0.25, y: 0.5, button: "left" },
    { ms: 4000, x: 0.75, y: 0.25, button: "right" },
  ]);
});

const CLICKS: CursorClick[] = [
  { ms: 1000, x: 0.25, y: 0.5, button: "left" },
  { ms: 4000, x: 0.75, y: 0.25, button: "right" },
];

const PULSE = { ...DEFAULT_CURSOR, clickEffect: "Pulse" as const };

test("the click effect rings left clicks, right clicks only when asked, and nothing when off or plain", () => {
  expect(ringEvents(CLICKS, PULSE)).toEqual([
    { ms: 1000, x: 0.25, y: 0.5, color: "#ff7a1a", size: 40, style: "pulse" },
  ]);
  expect(ringEvents(CLICKS, { ...PULSE, ringsRightClicks: true })).toHaveLength(
    2,
  );
  expect(ringEvents(CLICKS, DEFAULT_CURSOR)).toEqual([]);
  expect(ringEvents(CLICKS, { ...PULSE, mode: "Plain" })).toEqual([]);
});

test("a ring shows for half a second after its click", () => {
  const rings = ringEvents(CLICKS, PULSE);
  expect(ringsAt(rings, [], 999)).toEqual([]);
  expect(ringsAt(rings, [], 1250)).toEqual([{ index: 0, progress: 0.5 }]);
  expect(ringsAt(rings, [], 1260)).toEqual(ringsAt(rings, [], 1250));
  expect(ringsAt(rings, [], 1500)).toEqual([]);
});

test("a ring grows and fades, and a ripple sends a second one after it", () => {
  expect(ringCircles("ring", 0, 100)).toEqual([
    { radius: 20, alpha: 1, isFilled: false },
  ]);
  expect(ringCircles("ripple", 0.2, 100)).toHaveLength(1);
  expect(ringCircles("ripple", 0.5, 100)).toHaveLength(2);
});

const TRACK = readCursor(
  META,
  [
    '{"type":"cursor","t":100,"x":0,"y":40,"kind":"arrow"}',
    '{"type":"move","t":100,"x":0,"y":40}',
    '{"type":"move","t":101,"x":1000,"y":540}',
    '{"type":"down","t":101.5,"x":1000,"y":540,"button":"left"}',
    '{"type":"cursor","t":101.6,"x":1000,"y":540,"kind":"text"}',
    '{"type":"cursor","t":101.65,"x":1000,"y":540,"kind":"pointer"}',
    '{"type":"up","t":101.7,"x":1000,"y":540,"button":"left"}',
    '{"type":"move","t":102,"x":1000,"y":540}',
  ].join("\n"),
);
const RAW: CursorSettings = {
  ...DEFAULT_CURSOR,
  smoothing: 0,
  tilts: false,
  presses: false,
  leadsHovers: false,
  steadiesChanges: false,
};
const DURATION = 4000;

test("readCursor keeps the shape changes and how long the button was held", () => {
  expect(TRACK.kinds.map(({ kind }) => kind)).toEqual([
    "arrow",
    "text",
    "pointer",
  ]);
  expect(TRACK.presses[0].ms).toBeCloseTo(1500);
  expect(TRACK.presses[0].untilMs).toBeCloseTo(1700);
  expect(TRACK.aspect).toBe(1000 / 2000);
});

test("without smoothing, the cursor moves in a straight line between logged points", () => {
  const spot = cursorPath(TRACK, RAW, DURATION)(500)!;
  expect(spot.x).toBeCloseTo(0.25);
  expect(spot.y).toBeCloseTo(0.25);
  expect(spot).toMatchObject({ angle: 0, alpha: 1, scale: 1, kind: "arrow" });
  expect(cursorPath(TRACK, RAW, DURATION)(9000)).toMatchObject({
    x: 0.5,
    y: 0.5,
  });
});

test("with smoothing, the cursor trails the mouse, overshoots a little, then settles", () => {
  const along = (ms: number) =>
    cursorPath(TRACK, { ...RAW, smoothing: 50 }, DURATION)(ms)!.x;
  expect(along(500)).toBeLessThan(0.25);
  const peak = Math.max(...[1000, 1100, 1200, 1300, 1400].map(along));
  expect(peak).toBeGreaterThan(0.5);
  expect(peak).toBeLessThan(0.53);
  expect(along(3000)).toBeCloseTo(0.5, 3);
});

test("moving right tilts the cursor, the amount scales it, and it swings back", () => {
  const tilted = cursorPath(TRACK, { ...RAW, tilts: true }, DURATION);
  const stronger = cursorPath(
    TRACK,
    { ...RAW, tilts: true, tilt: 100 },
    DURATION,
  );
  expect(tilted(600)!.angle).toBeGreaterThan(1);
  expect(stronger(600)!.angle).toBeGreaterThan(tilted(600)!.angle);
  expect(Math.abs(tilted(3500)!.angle)).toBeLessThan(0.5);
  expect(cursorPath(TRACK, { ...RAW, angle: 10 }, DURATION)(500)!.angle).toBe(
    10,
  );
});

test("the shape follows the log, steadies quick flips, or stays an arrow", () => {
  const spotAt = cursorPath(TRACK, RAW, DURATION);
  expect(spotAt(1620)!.kind).toBe("text");
  expect(spotAt(1700)!.kind).toBe("pointer");
  const steady = cursorPath(TRACK, { ...RAW, steadiesChanges: true }, DURATION);
  expect(steady(1620)!.kind).toBe("arrow");
  expect(steady(1700)!.kind).toBe("pointer");
  const arrow = cursorPath(TRACK, { ...RAW, alwaysArrow: true }, DURATION);
  expect(arrow(1700)!.kind).toBe("arrow");
});

test("a click presses the cursor in while the button is held, then lets it go", () => {
  const spotAt = cursorPath(TRACK, { ...RAW, presses: true }, DURATION);
  expect(spotAt(1400)!.scale).toBe(1);
  expect(spotAt(1650)!.scale).toBeCloseTo(0.85);
  expect(spotAt(2000)!.scale).toBe(1);
});

test("the cursor fades out once still for two seconds, and can be turned off", () => {
  const spotAt = cursorPath(TRACK, RAW, DURATION);
  expect(spotAt(3000)?.alpha).toBe(1);
  expect(spotAt(3150)?.alpha).toBeCloseTo(0.5);
  expect(spotAt(3400)?.alpha).toBe(0);
  expect(
    cursorPath(TRACK, { ...RAW, hidesWhenStill: false }, DURATION)(3400)?.alpha,
  ).toBe(1);
  expect(
    cursorPath(TRACK, { ...RAW, mode: "Hidden" }, DURATION)(500),
  ).toBeNull();
});

test("stopping before the end freezes the cursor, and looping lands it exactly where it started", () => {
  const stopped = cursorPath(TRACK, { ...RAW, stopsBeforeEnd: 3.5 }, DURATION);
  expect(stopped(900)!.x).toBeCloseTo(0.25);
  const looped = cursorPath(TRACK, { ...RAW, loops: true }, DURATION);
  expect(looped(DURATION)!.x).toBeCloseTo(0);
  expect(looped(2500)!.x).toBeCloseTo(0.5);
  const smooth = cursorPath(
    TRACK,
    { ...DEFAULT_CURSOR, smoothing: 100, loops: true },
    DURATION,
  );
  const [start, end] = [smooth(0)!, smooth(DURATION)!];
  expect(end.x).toBeCloseTo(start.x);
  expect(end.y).toBeCloseTo(start.y);
  expect(end.angle).toBeCloseTo(start.angle);
});

test("a shake, out and back within a moment, is removed", () => {
  const shaky = readCursor(
    META,
    [
      '{"type":"move","t":100,"x":0,"y":40}',
      '{"type":"move","t":100.5,"x":100,"y":40}',
      '{"type":"move","t":100.55,"x":160,"y":40}',
      '{"type":"move","t":100.6,"x":101,"y":40}',
      '{"type":"move","t":101,"x":100,"y":40}',
    ].join("\n"),
  );
  const kept = cursorPath(shaky, { ...RAW, removesShakes: true }, DURATION);
  const shook = cursorPath(shaky, { ...RAW, removesShakes: false }, DURATION);
  expect(shook(550)!.x).toBeCloseTo(0.08);
  expect(kept(550)!.x).toBeLessThan(0.055);
});

test("visibleBox finds the pixels that show, or the whole picture when none do", () => {
  const alpha = new Array(4 * 4 * 3).fill(0);
  alpha[(1 * 4 + 2) * 4 + 3] = 255;
  alpha[(2 * 4 + 3) * 4 + 3] = 200;
  expect(visibleBox(alpha, 4)).toEqual({ x: 2, y: 1, width: 2, height: 2 });
  expect(visibleBox(new Array(16).fill(0), 2)).toEqual({
    x: 0,
    y: 0,
    width: 2,
    height: 2,
  });
});

test("plain mode shows the real cursor at its real size, with no effects", () => {
  const plain = {
    ...DEFAULT_CURSOR,
    mode: "Plain" as const,
    size: 200,
    angle: 20,
  };
  expect(cursorUnit(TRACK, plain)).toBe(1 / 2000);
  expect(cursorUnit(TRACK, DEFAULT_CURSOR)).toBeCloseTo(3.375 / 2000);
  const spot = cursorPath(TRACK, plain, DURATION)(500)!;
  expect(spot).toMatchObject({ angle: 0, scale: 1 });
  expect(spot.x).toBeCloseTo(0.25);
  expect(plainOr(plain)).toMatchObject({
    smoothing: 0,
    hidesWhenStill: false,
    clickEffect: "None",
  });
});

test("the export gets the cursor in output time with its picture, thinned where still", () => {
  const images = ["arrow", "text", "pointer"].map((kind) => ({
    kind,
    png: "",
    width: 28,
    height: 40,
    hotX: 5,
    hotY: 5,
  }));
  const track = { ...TRACK, images };
  const cursor = exportCursor(track, [], RAW, DURATION)!;
  expect(cursor.unit).toBeCloseTo(4.5 / 2000);
  expect(cursor.dot).toBe(0);
  expect(cursor.points[0]).toMatchObject({ t: 0, x: 0, y: 0, image: 0 });
  expect(cursor.points.some(({ image }) => image === 2)).toBe(true);
  expect(cursor.points.length).toBeLessThan(DURATION / (1000 / 60));
  expect(exportCursor(track, [], { ...RAW, style: "Dot" }, DURATION)!.dot).toBe(
    14,
  );
  expect(exportCursor(TRACK, [], RAW, DURATION)).toBeNull();
});

test("each style draws its own arrow, hand and text beam, and macOS keeps the real pictures", () => {
  const images = ["arrow", "pointer", "text"].map((kind) => ({
    kind,
    png: "PNG",
    width: 28,
    height: 40,
    hotX: 5,
    hotY: 5,
  }));
  expect(cursorPictures(images, "macOS").map(({ src }) => src)).toEqual(
    images.map(() => "data:image/png;base64,PNG"),
  );
  for (const style of ["Pointy", "Rounded", "No stem"] as const) {
    const [arrow, pointer, text] = cursorPictures(images, style);
    for (const picture of [arrow, pointer, text])
      expect(picture.src.startsWith("data:image/svg+xml,")).toBe(true);
    expect(arrow).toMatchObject({ kind: "arrow" });
    expect(pointer).toMatchObject({
      kind: "pointer",
      hotX: 10.875,
      hotY: 4.625,
    });
    expect(text).toMatchObject({ kind: "text", hotX: 9.625, hotY: 15.25 });
  }
  expect(cursorPictures(images, "Pointy")[0]).toMatchObject({
    hotX: 4,
    hotY: 4,
  });
  const [pointy, rounded] = (["Pointy", "Rounded"] as const).map((style) =>
    decodeURIComponent(cursorPictures(images, style)[0].src),
  );
  expect(pointy).toContain('stroke-linejoin="miter"');
  expect(rounded).toContain('stroke-linejoin="round"');
  expect(pointy).toContain(
    'width="179" height="254" viewBox="0 0 22.375 31.75"',
  );
});

test("suggestedZooms puts one zoom on each burst of left clicks, aimed at the first and panning to the rest, around existing zooms", () => {
  const click = (ms: number, x: number, button: "left" | "right" = "left") => ({
    ms,
    x,
    y: 0.5,
    button,
  });
  const clicks = [
    click(1000, 0.9),
    click(2500, 0.3),
    click(4000, 0.1, "right"),
    click(9000, 0.5),
    click(20_000, 0.2),
  ];
  const existing = {
    id: 4,
    kind: "zoom" as const,
    startMs: 19_000,
    endMs: 21_000,
    amount: 2,
  };
  const zooms = suggestedZooms(
    { clicks, keys: [], moves: [], typed: [] },
    [existing],
    10_000,
  ).slice(1);
  expect(zooms.map(({ id, startMs, endMs }) => [id, startMs, endMs])).toEqual([
    [5, 400, 4000],
    [6, 8400, 10_000],
  ]);
  expect(
    zooms.every(({ isSuggested, kind }) => isSuggested && kind === "zoom"),
  ).toBe(true);
  expect(zooms[0].center!.x).toBeCloseTo(1);
  expect(zooms[0].path).toEqual([{ afterMs: 2100, x: 0, y: 0.5 }]);
  expect(zooms[1]).toMatchObject({ center: { x: 0.5, y: 0.5 }, path: [] });
  expect(
    suggestedZooms(
      { clicks: [], keys: [], moves: [], typed: [] },
      [existing],
      10_000,
    ),
  ).toEqual([existing]);
});

test("suggestedSpeeds speeds up each stretch of typing that lasts three seconds, skipping short bursts and existing speeds", () => {
  const typing = (fromMs: number, toMs: number) =>
    Array.from(
      { length: (toMs - fromMs) / 500 + 1 },
      (_, i) => fromMs + i * 500,
    );
  const keys = [
    ...typing(1000, 5000),
    ...typing(8000, 9000),
    ...typing(12_000, 16_000),
  ];
  const existing = {
    id: 1,
    kind: "speed" as const,
    startMs: 15_000,
    endMs: 17_000,
    amount: 4,
  };
  const speeds = suggestedSpeeds(keys, [existing], 20_000).slice(1);
  expect(speeds).toEqual([
    {
      id: 2,
      kind: "speed",
      startMs: 1000,
      endMs: 5000,
      amount: 2,
      isSuggested: true,
    },
  ]);
});

test("typing gets an auto zoom aimed at the last click before it, joining a zoom it follows closely", () => {
  const keys = Array.from({ length: 9 }, (_, i) => 6000 + i * 500);
  const moves = [{ ms: 0, x: 0.5, y: 0.5 }];
  const alone = suggestedZooms(
    { clicks: [], keys, moves, typed: [] },
    [],
    20_000,
  );
  expect(alone).toMatchObject([
    { startMs: 5400, endMs: 11_500, center: { x: 0.5, y: 0.5 }, path: [] },
  ]);
  const clicks = [{ ms: 4000, x: 0.9, y: 0.5, button: "left" as const }];
  const [joined] = suggestedZooms(
    { clicks, keys, moves, typed: [] },
    [],
    20_000,
  );
  expect(joined).toMatchObject({ startMs: 3400, endMs: 11_500 });
  expect(joined.path).toEqual([]);
});

test("a typing zoom aims where the text appears and pans as it moves, not for tiny steps", () => {
  const keys = Array.from({ length: 9 }, (_, i) => 6000 + i * 500);
  const typed = [
    { ms: 6500, x: 0.9, y: 0.1 },
    { ms: 7000, x: 0.92, y: 0.1 },
    { ms: 8000, x: 0.5, y: 0.15 },
    { ms: 8500, x: 0.52, y: 0.15 },
  ];
  const moves = [{ ms: 0, x: 0.5, y: 0.5 }];
  const [zoom] = suggestedZooms({ clicks: [], keys, moves, typed }, [], 20_000);
  expect(zoom.center).toEqual({ x: 1, y: 0 });
  expect(zoom.path).toEqual([{ afterMs: 2600, x: 0.5, y: 0 }]);
});

test("a zoom pans only when the aimed view moves enough, so edge repeats and tiny moves don't jitter", () => {
  const at = (ms: number, x: number) => ({
    ms,
    x,
    y: 0.5,
    button: "left" as const,
  });
  const track = (clicks: ReturnType<typeof at>[]) => ({
    clicks,
    keys: [],
    moves: [],
    typed: [],
  });
  const [edge] = suggestedZooms(
    track([at(1000, 0.9), at(2000, 0.95)]),
    [],
    9000,
  );
  expect(edge.path).toEqual([]);
  const [tiny] = suggestedZooms(
    track([at(1000, 0.5), at(2000, 0.52)]),
    [],
    9000,
  );
  expect(tiny.path).toEqual([]);
  const [real] = suggestedZooms(
    track([at(1000, 0.5), at(2000, 0.7)]),
    [],
    9000,
  );
  expect(real.path).toEqual([{ afterMs: 1600, x: expect.closeTo(1), y: 0.5 }]);
});

test("a lone flicker far from the spots around it is dropped, but a real move to a new place is kept", () => {
  const spot = (ms: number, x: number, y: number) => ({ ms, x, y });
  const line = [spot(0, 0.2, 0.1), spot(500, 0.25, 0.1), spot(1000, 0.3, 0.1)];
  const flicker = spot(750, 0.8, 0.9);
  expect(steadySpots([line[0], line[1], flicker, line[2]])).toEqual(line);
  const field = [spot(1500, 0.6, 0.7), spot(2000, 0.62, 0.7)];
  expect(steadySpots([...line, ...field])).toEqual([...line, ...field]);
  expect(steadySpots([flicker])).toEqual([flicker]);
});

test("the cursor hides while its tip is outside the recording, when that's turned on", () => {
  const track = {
    ...TRACK,
    moves: [
      { ms: 0, x: 0.5, y: 0.5 },
      { ms: 1000, x: 1.2, y: 0.5 },
      { ms: 2000, x: 0.8, y: 0.5 },
    ],
  };
  const hiding = cursorPath(track, { ...RAW, hidesOutside: true }, DURATION);
  expect(hiding(500)?.alpha).toBe(1);
  expect(hiding(1000)?.alpha).toBe(0);
  expect(hiding(2000)?.alpha).toBe(1);
  const showing = cursorPath(track, RAW, DURATION);
  expect(showing(1000)?.alpha).toBe(1);
});

test("leading hovers cancels the smoothing lag, so a steady cursor sits where it really is", () => {
  const track = {
    ...TRACK,
    moves: Array.from({ length: 301 }, (_, step) => ({
      ms: step * 10,
      x: 0.1 + step * 0.002,
      y: 0.5,
    })),
  };
  const lagging = { ...DEFAULT_CURSOR, tilts: false, leadsHovers: false };
  const leading = { ...lagging, leadsHovers: true };
  const real = 0.1 + 200 * 0.002;
  const behind = real - cursorPath(track, lagging, DURATION)(2000)!.x;
  const off = Math.abs(real - cursorPath(track, leading, DURATION)(2000)!.x);
  expect(behind).toBeGreaterThan(0.01);
  expect(off).toBeLessThan(0.003);
});

test("a click ring plays in output time, so it lasts as long on the stage as in an export", () => {
  const rings = ringEvents([{ ms: 1000, x: 0.5, y: 0.5, button: "left" }], {
    ...RAW,
    clickEffect: "Ring",
  });
  const fast: Region[] = [
    { id: 1, kind: "speed", startMs: 0, endMs: 5000, amount: 2 },
  ];
  expect(ringsAt(rings, fast, 1900)).toHaveLength(1);
  expect(ringsAt(rings, fast, 2000)).toEqual([]);
});
