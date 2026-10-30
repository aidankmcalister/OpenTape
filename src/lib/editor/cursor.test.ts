import { expect, test } from "bun:test";
import {
  cursorPath,
  cursorPictures,
  cursorUnit,
  exportCursor,
  exportRings,
  readCursor,
  ringCircles,
  ringEvents,
  ringsAt,
  type CursorClick,
  visibleBox,
  steadySpots,
  suggestedSpeeds,
  suggestedZooms,
  outsideAlpha,
  nativeOr,
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

test("the click effect rings left clicks only, and nothing when off or native", () => {
  expect(ringEvents(CLICKS, PULSE)).toEqual([
    { ms: 1000, x: 0.25, y: 0.5, color: "#ff7a1a", size: 40, style: "pulse" },
  ]);
  expect(ringEvents(CLICKS, { ...PULSE, ringColor: "blue" })).toMatchObject([
    { color: "#3d9bff" },
  ]);
  expect(ringEvents(CLICKS, DEFAULT_CURSOR)).toEqual([]);
  expect(ringEvents(CLICKS, { ...PULSE, mode: "Native" })).toEqual([]);
});

test("a ring shows for half a second after its click, in the export's 60 steps", () => {
  const rings = ringEvents(CLICKS, PULSE);
  expect(ringsAt(rings, [], 999)).toEqual([]);
  expect(ringsAt(rings, [], 1000)).toEqual([{ index: 0, progress: 0 }]);
  expect(ringsAt(rings, [], 1250)).toEqual([{ index: 0, progress: 0.5 }]);
  expect(ringsAt(rings, [], 1258)).toEqual([{ index: 0, progress: 0.5 }]);
  expect(ringsAt(rings, [], 1259)).toEqual([{ index: 0, progress: 31 / 60 }]);
  expect(ringsAt(rings, [], 1499)).toEqual([{ index: 0, progress: 59 / 60 }]);
  expect(ringsAt(rings, [], 1500)).toEqual([]);
});

test("a ring grows and fades with a line 8% of its size, and a ripple sends a second one after it", () => {
  expect(ringCircles("ring", 0, 100)).toEqual([
    { radius: 20, alpha: 1, line: 8 },
  ]);
  expect(ringCircles("ring", 1, 16)[0]).toMatchObject({
    radius: 8,
    line: 1.28,
  });
  expect(ringCircles("pulse", 0, 100)[0]).toMatchObject({ line: 0 });
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
const NATIVE: CursorSettings = { ...DEFAULT_CURSOR, mode: "Native" };
const STYLED: CursorSettings = { ...DEFAULT_CURSOR, smoothing: 0 };
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

test("native, the cursor moves in a straight line between logged points", () => {
  const spot = cursorPath(TRACK, NATIVE, DURATION)(500)!;
  expect(spot.x).toBeCloseTo(0.25);
  expect(spot.y).toBeCloseTo(0.25);
  expect(spot).toMatchObject({ angle: 0, alpha: 1, scale: 1, kind: "arrow" });
  expect(cursorPath(TRACK, NATIVE, DURATION)(9000)).toMatchObject({
    x: 0.5,
    y: 0.5,
  });
});

test("with smoothing, the cursor overshoots a little, then settles", () => {
  const along = (ms: number) =>
    cursorPath(TRACK, DEFAULT_CURSOR, DURATION)(ms)!.x;
  const peak = Math.max(...[1000, 1100, 1200, 1300, 1400].map(along));
  expect(peak).toBeGreaterThan(0.5);
  expect(peak).toBeLessThan(0.53);
  expect(along(3000)).toBeCloseTo(0.5, 3);
});

test("moving right tilts a styled cursor, and it swings back", () => {
  const tilted = cursorPath(TRACK, STYLED, DURATION);
  expect(tilted(600)!.angle).toBeGreaterThan(1);
  expect(Math.abs(tilted(3500)!.angle)).toBeLessThan(0.5);
});

test("the shape follows the log, and a styled cursor skips quick flips", () => {
  const spotAt = cursorPath(TRACK, NATIVE, DURATION);
  expect(spotAt(1620)!.kind).toBe("text");
  expect(spotAt(1700)!.kind).toBe("pointer");
  const steady = cursorPath(TRACK, STYLED, DURATION);
  expect(steady(1620)!.kind).toBe("arrow");
  expect(steady(1700)!.kind).toBe("pointer");
});

test("a click presses the cursor in while the button is held, then lets it go", () => {
  const spotAt = cursorPath(TRACK, STYLED, DURATION);
  expect(spotAt(1400)!.scale).toBe(1);
  expect(spotAt(1650)!.scale).toBeCloseTo(0.85);
  expect(spotAt(2000)!.scale).toBe(1);
});

test("the cursor fades out once still for two seconds, and can be turned off", () => {
  const spotAt = cursorPath(
    TRACK,
    { ...STYLED, hidesWhenStill: true },
    DURATION,
  );
  expect(spotAt(3000)?.alpha).toBe(1);
  expect(spotAt(3150)?.alpha).toBeCloseTo(0.5);
  expect(spotAt(3400)?.alpha).toBe(0);
  expect(cursorPath(TRACK, STYLED, DURATION)(3400)?.alpha).toBe(1);
  expect(
    cursorPath(TRACK, { ...STYLED, mode: "Hidden" }, DURATION)(500),
  ).toBeNull();
});

test("with Hide when still, a cursor stays hidden until it moves, then fades in", () => {
  const hides = { ...STYLED, hidesWhenStill: true };
  const spotAt = cursorPath(TRACK, hides, DURATION);
  expect(spotAt(0)?.alpha).toBe(0);
  expect(spotAt(900)?.alpha).toBe(0);
  expect(spotAt(1000)?.alpha).toBe(0);
  expect(spotAt(1150)?.alpha).toBeCloseTo(0.5);
  expect(spotAt(1300)?.alpha).toBe(1);
  const wakes = cursorPath(
    {
      ...TRACK,
      moves: [
        { ms: 0, x: 0.1, y: 0.1 },
        { ms: 100, x: 0.2, y: 0.2 },
        { ms: 5000, x: 0.2, y: 0.2 },
        { ms: 5100, x: 0.3, y: 0.3 },
      ],
    },
    hides,
    DURATION,
  );
  expect(wakes(4000)?.alpha).toBe(0);
  expect(wakes(5100)?.alpha).toBe(0);
  expect(wakes(5250)?.alpha).toBeCloseTo(0.5);
  expect(wakes(5400)?.alpha).toBe(1);
  const never = cursorPath(
    { ...TRACK, moves: [{ ms: 0, x: 0.5, y: 0.5 }] },
    hides,
    DURATION,
  );
  expect(never(0)?.alpha).toBe(0);
  expect(never(5000)?.alpha).toBe(0);
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
  const kept = cursorPath(shaky, STYLED, DURATION);
  const shook = cursorPath(shaky, NATIVE, DURATION);
  expect(shook(550)!.x).toBeCloseTo(0.08);
  expect(kept(550)!.x).toBeLessThan(0.055);
});

test("the cursor stops at the kept video's end, so trimming doesn't show the move to Stop", () => {
  const kept = { startMs: 0, endMs: 500 };
  expect(cursorPath(TRACK, NATIVE, DURATION, kept)(900)!.x).toBeCloseTo(0.25);
});

test("a shake is removed even from rest or over several samples, if it jumps at least the shake size", () => {
  const at = (ms: number, points: number) => ({ ms, x: points / 2000, y: 0.5 });
  const track = {
    ...TRACK,
    moves: [
      at(0, 100),
      at(1000, 112),
      at(1010, 120),
      at(1030, 101),
      at(2000, 400),
      at(2050, 600),
      at(2100, 800),
      at(3000, 805),
      at(3010, 800),
    ],
  };
  const kept = cursorPath(track, STYLED, DURATION);
  expect(kept(1010)!.x * 2000).toBeCloseTo(101, 0);
  expect(kept(2050)!.x * 2000).toBeCloseTo(600);
  expect(kept(3000)!.x * 2000).toBeCloseTo(805);
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

const BOX = { x: 0, y: 0, width: 1000, height: 500 };
const VIEW = {
  zoom: [{ scale: 1, x: 0.5, y: 0.5 }],
  recording: BOX,
  video: BOX,
};

const IMAGES = ["arrow", "text", "pointer"].map((kind) => ({
  kind,
  png: "",
  width: 28,
  height: 40,
  hotX: 5,
  hotY: 5,
}));

const EVERYTHING: CursorSettings = {
  ...DEFAULT_CURSOR,
  size: 200,
  style: "Dot",
  smoothing: 100,
  hidesWhenStill: true,
  hidesOutside: true,
  clickEffect: "Ripple",
};

test("native mode shows the real cursor at the default size, whatever the Styled settings say", () => {
  const native = { ...EVERYTHING, mode: "Native" as const };
  const spotAt = cursorPath(TRACK, native, DURATION);
  const real = { angle: 0, alpha: 1, scale: 1 };
  expect(spotAt(500)).toMatchObject({ ...real, kind: "arrow" });
  expect(spotAt(500)!.x).toBeCloseTo(0.25);
  expect(spotAt(900)!.x).toBeCloseTo(0.45);
  expect(spotAt(1620)).toMatchObject({ ...real, kind: "text" });
  expect(spotAt(1650)).toMatchObject({ ...real, kind: "text" });
  expect(spotAt(3900)).toMatchObject({ ...real, kind: "pointer" });
  expect(spotAt(DURATION)!.x).toBeCloseTo(0.5);
  expect(cursorUnit(TRACK, native)).toBeCloseTo(3.5 / 2000, 10);
  expect(nativeOr(native).hidesOutside).toBe(false);
  expect(ringEvents(CLICKS, native)).toEqual([]);
  expect(
    exportCursor({ ...TRACK, images: IMAGES }, [], native, DURATION, VIEW),
  ).toMatchObject({ unit: cursorUnit(TRACK, native), dot: 0 });
});

test("Size scales the cursor from 3.5 times real size at 100%, the same on the stage and in the export", () => {
  expect(cursorUnit(TRACK, STYLED)).toBeCloseTo(3.5 / 2000, 10);
  expect(cursorUnit(TRACK, { ...STYLED, size: 200 })).toBeCloseTo(7 / 2000, 10);
  const exported = exportCursor(
    { ...TRACK, images: IMAGES },
    [],
    STYLED,
    DURATION,
    VIEW,
  );
  expect(exported!.unit).toBe(cursorUnit(TRACK, STYLED));
});

test("Hidden draws no cursor and no click effect anywhere", () => {
  const hidden = { ...EVERYTHING, mode: "Hidden" as const };
  expect(cursorPath(TRACK, hidden, DURATION)(500)).toBeNull();
  expect(
    exportCursor({ ...TRACK, images: IMAGES }, [], hidden, DURATION, VIEW),
  ).toBeNull();
  expect(ringEvents(CLICKS, hidden)).toEqual([]);
});

test("the export gets the cursor in output time with its picture, press and fade, thinned where still", () => {
  const track = { ...TRACK, images: IMAGES };
  const cursor = exportCursor(track, [], NATIVE, DURATION, VIEW)!;
  expect(cursor.dot).toBe(0);
  expect(cursor.points[0]).toMatchObject({ t: 0, x: 0, y: 0, image: 0 });
  expect(cursor.points.some(({ image }) => image === 2)).toBe(true);
  expect(cursor.points.length).toBeLessThan(DURATION / (1000 / 60));
  const styled = exportCursor(
    track,
    [],
    { ...STYLED, hidesWhenStill: true, hidesOutside: true },
    DURATION,
    VIEW,
  )!;
  expect(Math.min(...styled.points.map(({ scale }) => scale))).toBeCloseTo(
    0.85,
  );
  expect(styled.points[styled.points.length - 1].alpha).toBe(0);
  expect(
    exportCursor(track, [], { ...STYLED, style: "Dot" }, DURATION, VIEW)!.dot,
  ).toBe(14);
  expect(exportCursor(TRACK, [], STYLED, DURATION, VIEW)).toBeNull();
});

test("Hide outside fades an export point when a zoom moves the view off a still cursor", () => {
  const still = {
    ...TRACK,
    images: IMAGES,
    moves: [{ ms: 0, x: 0.5, y: 0.5 }],
  };
  const zoom = Array.from({ length: 241 }, (_, frame) => ({
    scale: 1 + frame / 120,
    x: 0,
    y: 0.5,
  }));
  const alphas = (hidesOutside: boolean) =>
    exportCursor(still, [], { ...STYLED, hidesOutside }, DURATION, {
      ...VIEW,
      zoom,
    })!.points.map(({ alpha }) => alpha);
  expect(alphas(false).every((alpha) => alpha === 1)).toBe(true);
  const faded = alphas(true);
  expect(faded[0]).toBe(1);
  expect(faded.some((alpha) => alpha > 0 && alpha < 1)).toBe(true);
  expect(faded[faded.length - 1]).toBe(0);
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

test("suggestedZooms puts one zoom on each burst of left clicks, aimed at the first and panning to the rest, around existing zooms, and skips the click that stops the recording", () => {
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
    click(9600, 0.9),
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
    { clicks, keys: [], moves: [], typed: [], pauses: [] },
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
      { clicks: [], keys: [], moves: [], typed: [], pauses: [] },
      [existing],
      10_000,
    ),
  ).toEqual([existing]);
});

test("suggestedZooms skips the record bar's Pause click before a pause and its Resume click during it, but not clicks after", () => {
  const track = readCursor(
    META,
    [
      '{"type":"down","t":101,"x":500,"y":540,"button":"left"}',
      '{"type":"down","t":102.7,"x":1900,"y":60,"button":"left"}',
      '{"type":"down","t":104.9,"x":1900,"y":60,"button":"left"}',
      '{"type":"down","t":109,"x":500,"y":540,"button":"left"}',
    ].join("\n"),
  );
  expect(track.pauses).toEqual([3000]);
  const zooms = suggestedZooms(track, [], 10_000);
  expect(zooms.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
    [400, 2500],
    [6400, 8500],
  ]);
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
    { clicks: [], keys, moves, typed: [], pauses: [] },
    [],
    20_000,
  );
  expect(alone).toMatchObject([
    { startMs: 5100, endMs: 11_500, center: { x: 0.5, y: 0.5 }, path: [] },
  ]);
  const clicks = [{ ms: 4000, x: 0.9, y: 0.5, button: "left" as const }];
  const [joined] = suggestedZooms(
    { clicks, keys, moves, typed: [], pauses: [] },
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
  const [zoom] = suggestedZooms(
    { clicks: [], keys, moves, typed, pauses: [] },
    [],
    20_000,
  );
  expect(zoom.center).toEqual({ x: 1, y: 0 });
  expect(zoom.path).toEqual([{ afterMs: 2900, x: 0.5, y: 0 }]);
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
    pauses: [],
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

test("a styled cursor leads by its smoothing lag, so a steady cursor sits where it really is", () => {
  const track = {
    ...TRACK,
    moves: Array.from({ length: 301 }, (_, step) => ({
      ms: step * 10,
      x: 0.1 + step * 0.002,
      y: 0.5,
    })),
  };
  const real = 0.1 + 200 * 0.002;
  const off = Math.abs(
    real - cursorPath(track, DEFAULT_CURSOR, DURATION)(2000)!.x,
  );
  expect(off).toBeLessThan(0.003);
});

test("a click ring plays in output time, so it lasts as long on the stage as in an export", () => {
  const rings = ringEvents([{ ms: 1000, x: 0.5, y: 0.5, button: "left" }], {
    ...STYLED,
    clickEffect: "Ring",
  });
  const fast: Region[] = [
    { id: 1, kind: "speed", startMs: 0, endMs: 5000, amount: 2 },
  ];
  expect(ringsAt(rings, fast, 1900)).toHaveLength(1);
  expect(ringsAt(rings, fast, 2000)).toEqual([]);
  expect(exportRings(rings, fast, 1.5)).toEqual([
    { t: 0.5, x: 0.5, y: 0.5, color: "#ff7a1a", size: 60, style: "ring" },
  ]);
});

test("the cursor stays put when still or outside, unless those switches are on", () => {
  expect(DEFAULT_CURSOR.hidesWhenStill).toBe(false);
  expect(DEFAULT_CURSOR.hidesOutside).toBe(false);
  expect(outsideAlpha(false, { x: 1.4, y: 0.5 })).toBe(1);
});

test("Hide outside fades the cursor as its tip leaves the view, never all at once", () => {
  expect(outsideAlpha(true, { x: 0.5, y: 0.5 })).toBe(1);
  expect(outsideAlpha(true, { x: 1, y: 1 })).toBe(1);
  expect(outsideAlpha(true, { x: 1.01, y: 0.5 })).toBeCloseTo(2 / 3);
  expect(outsideAlpha(true, { x: 0.5, y: 1.2 })).toBe(0);
});
