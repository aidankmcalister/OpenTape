import type {
  CursorImage,
  CursorPoint,
  ExportCursor,
  ExportRing,
  RingStyle,
} from "@/lib/bindings";
import { clamp, type Point } from "@/lib/geometry";
import {
  CURSOR_STYLES,
  type CursorPaint,
  type CursorMode,
  type CursorSettings,
  type CursorStyle,
  MARK_COLORS,
} from "./appearance";
import {
  nextId,
  outputAt,
  type Region,
  type RegionKind,
  REGIONS,
  type Setting,
  type Span,
} from "./regions";
import { type Clip, keptClips } from "./clips";
import { FRAME_MS, STEP_MS } from "./timeline";
import { centeredOn } from "./zoom";

export type CursorClick = {
  ms: number;
  x: number;
  y: number;
  button: "left" | "right";
};

type Meta = {
  first_frame_time: number;
  screen_rect: { x: number; y: number; width: number; height: number };
  pauses: [number, number][];
};

type Event = {
  type: "move" | "down" | "up" | "cursor" | "key";
  t: number;
  x: number;
  y: number;
  button?: "left" | "right";
  kind?: string;
};

const RING_MS = 500;
const RING_STEPS = 60;

export type CursorMove = { ms: number; x: number; y: number };

type Moment<T> = { ms: number } & T;

export type CursorTrack = {
  moves: CursorMove[];
  clicks: CursorClick[];
  presses: Moment<{ untilMs: number }>[];
  kinds: Moment<{ kind: string }>[];
  keys: number[];
  typed: CursorMove[];
  pointShare: number;
  aspect: number;
  images: CursorImage[];
};

export const NO_CURSOR: CursorTrack = {
  moves: [],
  clicks: [],
  presses: [],
  kinds: [],
  keys: [],
  typed: [],
  pointShare: 0,
  aspect: 1,
  images: [],
};

const IDLE_MS = 2000;
const FADE_MS = 300;
const OUTSIDE_FADE = 0.03;
const LOOP_MS = 1000;
const STEADY_MS = 120;
const SHAKE_MS = 150;
const PRESS_IN_MS = 60;
const PRESS_OUT_MS = 150;
const PRESS_DIP = 0.15;
const SWING = { stiffness: 140, damping: 9 };
const TILT_PER_SPEED = 18;
const MAX_TILT = 30;
const CURSOR_SCALE = 3.375;
export const DOT_POINTS = 14;

export const CURSOR_MODES: Record<CursorMode, string> = {
  Hidden: "No cursor is drawn over the recording.",
  Plain: "Shows the cursor exactly as macOS drew it.",
  Styled: "Size, motion, tilt and click effects apply.",
};

export const CURSOR_SECTIONS: { title: string; settings: Setting[] }[] = [
  {
    title: "Style",
    settings: [
      {
        kind: "slider",
        key: "size",
        label: "Size",
        min: 25,
        max: 200,
        step: 5,
        unit: "%",
      },
      {
        kind: "switch",
        key: "alwaysArrow",
        label: "Always use pointer",
        help: "Keeps the arrow, even over links and text.",
      },
    ],
  },
  {
    title: "Movement",
    settings: [
      {
        kind: "slider",
        key: "smoothing",
        label: "Smoothing",
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
      },
      {
        kind: "switch",
        key: "hidesWhenStill",
        label: "Hide when still",
        help: "Fades the cursor out after 2 seconds without moving.",
      },
      {
        kind: "switch",
        key: "hidesOutside",
        label: "Hide outside the recording",
        help: "Fades the cursor out as its tip leaves the visible recording, so it never hangs over the background.",
      },
      {
        kind: "switch",
        key: "loops",
        label: "Loop back to the start",
        help: "Glides the cursor back to where the video starts over the last second, so the video loops smoothly.",
      },
      {
        kind: "slider",
        key: "stopsBeforeEnd",
        label: "Stop before the end",
        min: 0,
        max: 3,
        step: 0.1,
        unit: "s",
        help: "Freezes the cursor this long before the end, so the move to the Stop button doesn't show.",
      },
    ],
  },
  {
    title: "Rotation",
    settings: [
      {
        kind: "slider",
        key: "angle",
        label: "Angle",
        min: -45,
        max: 45,
        step: 1,
        unit: "°",
      },
      { kind: "switch", key: "tilts", label: "Tilt while moving" },
      {
        kind: "slider",
        key: "tilt",
        label: "Tilt amount",
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
        onlyWith: "tilts",
      },
    ],
  },
  {
    title: "Clicks",
    settings: [
      {
        kind: "choice",
        key: "clickEffect",
        options: ["None", "Ring", "Pulse", "Ripple"],
      },
      { kind: "color", key: "ringColor", label: "Color", initial: "orange" },
      {
        kind: "slider",
        key: "ringSize",
        label: "Ring size",
        min: 16,
        max: 96,
        step: 4,
        unit: "px",
      },
      { kind: "switch", key: "ringsRightClicks", label: "Also on right click" },
      {
        kind: "switch",
        key: "presses",
        label: "Press on click",
        help: "Shrinks the cursor a little while the left button is held.",
      },
    ],
  },
  {
    title: "Advanced",
    settings: [
      {
        kind: "switch",
        key: "removesShakes",
        label: "Remove shakes",
        help: "Drops quick jumps that come straight back, like a bumped mouse.",
      },
      {
        kind: "slider",
        key: "shakeThreshold",
        label: "Shake size",
        min: 1,
        max: 30,
        step: 1,
        unit: "pt",
        help: "Only jumps at least this far count as shakes.",
        onlyWith: "removesShakes",
      },
      {
        kind: "switch",
        key: "steadiesChanges",
        label: "Steady quick cursor changes",
        help: "Skips cursor shapes that only flash by, like a text beam crossed on the way to a button.",
      },
      {
        kind: "switch",
        key: "leadsHovers",
        label: "Keep in sync with hovers",
        help: "Makes up for the smoothing delay, so the cursor reaches a button as it lights up.",
      },
    ],
  },
];

export function readCursor(meta: string, events: string): CursorTrack {
  const { first_frame_time, screen_rect, pauses }: Meta = JSON.parse(meta);
  const videoMs = (t: number) => {
    const paused = pauses
      .filter(([start]) => start < t)
      .reduce((sum, [start, end]) => sum + Math.min(end, t) - start, 0);
    return (t - first_frame_time - paused) * 1000;
  };
  const isPaused = (t: number) =>
    pauses.some(([start, end]) => t >= start && t < end);
  const logged = events
    .split("\n")
    .filter((line) => line.trim())
    .map((line): Event => JSON.parse(line))
    .filter(({ t }) => t >= first_frame_time && !isPaused(t))
    .map(({ type, t, x, y, button = "left", kind = "arrow" }) => ({
      type,
      ms: videoMs(t),
      x: (x - screen_rect.x) / screen_rect.width,
      y: (y - screen_rect.y) / screen_rect.height,
      button,
      kind,
    }));
  const lefts = logged.filter(({ button }) => button === "left");
  return {
    moves: logged
      .filter(({ type }) => type !== "key")
      .map(({ ms, x, y }) => ({ ms, x, y })),
    clicks: logged
      .filter(({ type }) => type === "down")
      .map(({ ms, x, y, button }) => ({ ms, x, y, button })),
    presses: lefts
      .filter(({ type }) => type === "down")
      .map(({ ms }) => ({
        ms,
        untilMs: lefts.find((up) => up.type === "up" && up.ms >= ms)?.ms ?? ms,
      })),
    kinds: logged
      .filter(({ type }) => type === "cursor")
      .map(({ ms, kind }) => ({ ms, kind })),
    keys: logged.filter(({ type }) => type === "key").map(({ ms }) => ms),
    typed: [],
    pointShare: 1 / screen_rect.width,
    aspect: screen_rect.height / screen_rect.width,
    images: [],
  };
}

type Shape = { path: string; lines?: string; size: number[]; hot: number[] };

const HAND: Shape = {
  path: "M4 2Q4 .5 5.5 .5T7 2V7.2Q7.2 6.6 8.3 6.6T9.6 7.8Q9.9 7.2 10.9 7.2T12.2 8.6Q12.6 8.2 13.3 8.3T14.4 9.8V13Q14.4 15.6 12.6 17V18.5H4.8V17.2Q3.6 16.3 2.6 14.6L.7 11.3Q.2 10.3 1.1 9.8T2.8 10.4L4 11.9Z",
  lines: "M7 7.2V10.6M9.6 7.8V10.6M12.2 8.6V10.6",
  size: [14.4, 18.5],
  hot: [5.5, 0.5],
};

const SHAPES: Partial<Record<CursorStyle, Record<string, Shape>>> = {
  Pointy: {
    arrow: {
      path: "M0 0V16L4.5 12.5L7.5 19L10 18L7 11.5H11.5Z",
      size: [11.5, 19],
      hot: [0, 0],
    },
    pointer: HAND,
    text: {
      path: "M0 0H9V1.5H5.25V16.5H9V18H0V16.5H3.75V1.5H0Z",
      size: [9, 18],
      hot: [4.5, 9],
    },
  },
  Rounded: {
    arrow: {
      path: "M0 1Q0 0 .8 .7L10.8 10.4Q11.6 11.3 10.5 11.5H7L9.7 17.4Q10 18.2 9.2 18.5L8.3 18.9Q7.5 19.2 7.2 18.4L4.5 12.5L1.3 15.1Q0 16.1 0 14.6Z",
      size: [11.6, 19.2],
      hot: [0.3, 0.3],
    },
    pointer: HAND,
    text: {
      path: "M0 0H3Q4.5 0 4.5 1.5Q4.5 0 6 0H9V1.5H6Q5.25 1.5 5.25 2.5V15.5Q5.25 16.5 6 16.5H9V18H6Q4.5 18 4.5 16.5Q4.5 18 3 18H0V16.5H3Q3.75 16.5 3.75 15.5V2.5Q3.75 1.5 3 1.5H0Z",
      size: [9, 18],
      hot: [4.5, 9],
    },
  },
  "No stem": {
    arrow: {
      path: "M0 1Q0 0 .8 .6L10.2 9.4Q11 10.2 9.9 10.3L5 10.6L1.3 14Q0 15 0 13.6Z",
      size: [10.6, 14.6],
      hot: [0.3, 0.3],
    },
    pointer: HAND,
    text: {
      path: "M3.75 .5Q3.75 0 4.5 0T5.25 .5V17.5Q5.25 18 4.5 18T3.75 17.5Z",
      size: [9, 18],
      hot: [4.5, 9],
    },
  },
};
const SHAPE_SCALE = 1.25;
const SHAPE_PAD = 4;
export const SHAPE_RASTER = 8;

type CursorPicture = Omit<CursorImage, "png"> & { src: string };

export function cursorPictures(
  images: CursorImage[],
  style: CursorStyle,
): CursorPicture[] {
  const paint = CURSOR_STYLES[style];
  return images.map(({ png, ...image }) => {
    const shape = SHAPES[style]?.[image.kind];
    return paint && shape
      ? shapePicture(image.kind, shape, paint)
      : { ...image, src: `data:image/png;base64,${png}` };
  });
}

function shapePicture(
  kind: string,
  shape: Shape,
  paint: CursorPaint,
): CursorPicture {
  const at = (value: number) => SHAPE_PAD + value * SHAPE_SCALE;
  const [width, height] = shape.size.map((side) => at(side) + SHAPE_PAD);
  const stroke = (strokeWidth: number) =>
    `stroke="${paint.edge}" stroke-width="${strokeWidth}" stroke-linejoin="${paint.join}" stroke-linecap="round"`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SHAPE_RASTER}" height="${height * SHAPE_RASTER}" viewBox="0 0 ${width} ${height}">`,
    `<g transform="translate(${SHAPE_PAD} ${SHAPE_PAD}) scale(${SHAPE_SCALE})">`,
    `<path d="${shape.path}" fill="${paint.fill}" ${stroke(paint.edgeWidth / SHAPE_SCALE)} paint-order="stroke"/>`,
    shape.lines
      ? `<path d="${shape.lines}" fill="none" ${stroke(paint.edgeWidth / 2 / SHAPE_SCALE)}/>`
      : "",
    `</g>`,
    `</svg>`,
  ].join("");
  return {
    kind,
    width,
    height,
    hotX: at(shape.hot[0]),
    hotY: at(shape.hot[1]),
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
  };
}

export function visibleBox(alpha: ArrayLike<number>, width: number) {
  const height = alpha.length / 4 / width;
  let [left, top, right, bottom] = [width, height, 0, 0];
  for (let index = 3; index < alpha.length; index += 4) {
    if (alpha[index] < 16) continue;
    const [x, y] = [
      ((index - 3) / 4) % width,
      Math.floor((index - 3) / 4 / width),
    ];
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x + 1), Math.max(bottom, y + 1)];
  }
  if (right <= left) return { x: 0, y: 0, width, height };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function plainOr(settings: CursorSettings): CursorSettings {
  if (settings.mode === "Styled") return settings;
  return {
    ...settings,
    style: "macOS",
    alwaysArrow: false,
    smoothing: 0,
    hidesWhenStill: false,
    hidesOutside: false,
    loops: false,
    stopsBeforeEnd: 0,
    angle: 0,
    tilts: false,
    clickEffect: "None",
    presses: false,
    removesShakes: false,
    steadiesChanges: false,
    leadsHovers: false,
  };
}

export function cursorUnit(track: CursorTrack, settings: CursorSettings) {
  if (settings.mode !== "Styled") return track.pointShare;
  return (track.pointShare * settings.size * CURSOR_SCALE) / 100;
}

type CursorSpot = {
  x: number;
  y: number;
  angle: number;
  alpha: number;
  scale: number;
  kind: string;
};

export function cursorPath(
  track: CursorTrack,
  chosen: CursorSettings,
  durationMs: number,
  clips: Clip[] = [],
): (ms: number) => CursorSpot | null {
  const settings = plainOr(chosen);
  if (settings.mode === "Hidden" || track.moves.length === 0) return () => null;
  const moves = settings.removesShakes
    ? withoutShakes(track, settings.shakeThreshold)
    : track.moves;
  const kinds = settings.steadiesChanges ? steadied(track.kinds) : track.kinds;
  const lastMs = Math.max(moves[moves.length - 1].ms, durationMs);
  const stiffness = 600 * 0.1 ** (settings.smoothing / 100);
  const damping = 2 * 0.84 * Math.sqrt(stiffness);
  const dt = STEP_MS / 1000;
  const leadMs =
    settings.leadsHovers && settings.smoothing > 0
      ? (damping / stiffness) * 1000
      : 0;
  const kept = keptClips(clips, durationMs);
  const [startMs, endMs] = [kept[0].startMs, kept[kept.length - 1].endMs];
  const stopMs = endMs - settings.stopsBeforeEnd * 1000;
  const targetAt = (ms: number) =>
    positionAt(moves, Math.min(ms + leadMs, stopMs));
  const steps: Omit<CursorSpot, "alpha" | "scale" | "kind">[] = [];
  let [x, y, vx, vy] = [moves[0].x, moves[0].y, 0, 0];
  let [lean, spin] = [0, 0];
  for (let ms = 0; ms <= lastMs + 3000; ms += STEP_MS) {
    const target = targetAt(ms);
    if (settings.smoothing > 0) {
      vx += (stiffness * (target.x - x) - damping * vx) * dt;
      vy += (stiffness * (target.y - y) - damping * vy) * dt;
      [x, y] = [x + vx * dt, y + vy * dt];
    } else {
      [vx, vy] = [(target.x - x) / dt, (target.y - y) / dt];
      [x, y] = [target.x, target.y];
    }
    const want = settings.tilts
      ? clamp((vx * TILT_PER_SPEED * settings.tilt) / 50, -MAX_TILT, MAX_TILT)
      : 0;
    spin += (SWING.stiffness * (want - lean) - SWING.damping * spin) * dt;
    lean += spin * dt;
    steps.push({ x, y, angle: settings.angle + lean });
  }
  const movedAt = moves.filter(
    (move, index) =>
      index > 0 &&
      (move.x !== moves[index - 1].x || move.y !== moves[index - 1].y),
  );
  const stepAt = (ms: number) => {
    const index = clamp(ms / STEP_MS, 0, steps.length - 1);
    const [from, to] = [steps[Math.floor(index)], steps[Math.ceil(index)]];
    const share = index - Math.floor(index);
    const mix = (key: "x" | "y" | "angle") =>
      from[key] + (to[key] - from[key]) * share;
    return { x: mix("x"), y: mix("y"), angle: mix("angle") };
  };
  const start = stepAt(startMs);
  return (ms) => {
    const now = stepAt(ms);
    const back = settings.loops
      ? smoothstep(clamp((ms - endMs + LOOP_MS) / LOOP_MS, 0, 1))
      : 0;
    const mix = (key: "x" | "y" | "angle") =>
      now[key] + (start[key] - now[key]) * back;
    const lastMovedMs = movedAt[firstAfter(movedAt, ms) - 1]?.ms ?? 0;
    const alpha = settings.hidesWhenStill
      ? clamp(1 - (ms - lastMovedMs - IDLE_MS) / FADE_MS, 0, 1)
      : 1;
    const kind = settings.alwaysArrow
      ? "arrow"
      : (kinds[firstAfter(kinds, ms) - 1]?.kind ?? "arrow");
    const scale = settings.presses
      ? 1 - PRESS_DIP * pressAt(track.presses, ms)
      : 1;
    return {
      x: mix("x"),
      y: mix("y"),
      angle: mix("angle"),
      alpha,
      scale,
      kind,
    };
  };
}

export function outsideAlpha(settings: CursorSettings, tip: Point): number {
  if (!plainOr(settings).hidesOutside) return 1;
  const outside = Math.max(0, -tip.x, tip.x - 1, -tip.y, tip.y - 1);
  return clamp(1 - outside / OUTSIDE_FADE, 0, 1);
}

function withoutShakes(
  { moves, pointShare, aspect }: CursorTrack,
  threshold: number,
) {
  const points = (a: CursorMove, b: CursorMove) =>
    Math.hypot(a.x - b.x, (a.y - b.y) * aspect) / pointShare;
  const kept = moves.slice(0, 1);
  for (let index = 1; index < moves.length; index++) {
    const anchor = kept[kept.length - 1];
    const isSoon = (at: number) =>
      at < moves.length && moves[at].ms - moves[index].ms < SHAKE_MS;
    let back = index;
    while (isSoon(back) && points(moves[back], anchor) >= threshold / 2) back++;
    const strays = moves
      .slice(index, back)
      .some((move) => points(move, anchor) > threshold);
    if (strays && isSoon(back)) index = back - 1;
    else kept.push(moves[index]);
  }
  return kept;
}

function steadied(kinds: CursorTrack["kinds"]) {
  return kinds.filter(
    (change, index) =>
      index === kinds.length - 1 ||
      kinds[index + 1].ms - change.ms >= STEADY_MS,
  );
}

function pressAt(presses: CursorTrack["presses"], ms: number): number {
  return presses.reduce((deepest, { ms: downMs, untilMs }) => {
    if (ms < downMs || ms > untilMs + PRESS_OUT_MS) return deepest;
    const dip =
      ms <= untilMs
        ? clamp((ms - downMs) / PRESS_IN_MS, 0, 1)
        : 1 - (ms - untilMs) / PRESS_OUT_MS;
    return Math.max(deepest, dip);
  }, 0);
}

function smoothstep(share: number) {
  return share * share * (3 - 2 * share);
}

export function positionAt(moves: CursorMove[], ms: number) {
  const after = firstAfter(moves, ms);
  if (after === moves.length) return moves[moves.length - 1];
  if (after === 0) return moves[0];
  const [from, to] = [moves[after - 1], moves[after]];
  const share = (ms - from.ms) / (to.ms - from.ms);
  return {
    x: from.x + (to.x - from.x) * share,
    y: from.y + (to.y - from.y) * share,
  };
}

function firstAfter(sorted: { ms: number }[], ms: number): number {
  let [low, high] = [0, sorted.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle].ms <= ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function exportCursor(
  track: CursorTrack,
  regions: Region[],
  settings: CursorSettings,
  durationMs: number,
  clips: Clip[] = [],
): ExportCursor | null {
  const spotAt = cursorPath(track, settings, durationMs, clips);
  if (!spotAt(0) || track.images.length === 0) return null;
  const { style, hidesOutside } = plainOr(settings);
  const imageOf = (kind: string) =>
    Math.max(
      0,
      track.images.findIndex((image) => image.kind === kind),
    );
  const points: CursorPoint[] = [];
  for (let ms = 0; ms <= durationMs; ms += FRAME_MS) {
    const spot = spotAt(ms);
    if (!spot) continue;
    const { kind, ...rest } = spot;
    points.push({
      t: outputAt(regions, ms) / 1000,
      ...rest,
      image: imageOf(kind),
    });
  }
  return {
    points: points.filter(
      (point, index) =>
        !sameSpot(point, points[index - 1]) ||
        !sameSpot(point, points[index + 1]),
    ),
    images: track.images,
    unit: cursorUnit(track, settings),
    dot: style === "Dot" ? DOT_POINTS : 0,
    outsideFade: hidesOutside ? OUTSIDE_FADE : 0,
  };
}

function sameSpot(a: CursorPoint, b?: CursorPoint) {
  return (
    b !== undefined &&
    (["x", "y", "angle", "alpha", "scale", "image"] as const).every(
      (key) => a[key] === b[key],
    )
  );
}

export type RingEvent = {
  ms: number;
  x: number;
  y: number;
  color: string;
  size: number;
  style: RingStyle;
};

const ZOOM_GROUP_MS = 3000;
const ZOOM_LEAD_MS = 600;
const ZOOM_HOLD_MS = 1500;
const TYPING_GAP_MS = 1500;
const TYPING_MIN_MS = 3000;
const MIN_PAN_SHARE = 0.08;
const STRAY_SHARE = 0.2;

type SuggestionTrack = Pick<CursorTrack, "clicks" | "keys" | "moves" | "typed">;

export function withSuggestions(
  track: SuggestionTrack,
  regions: Region[],
  durationMs: number,
): Region[] {
  return suggestedSpeeds(
    track.keys,
    suggestedZooms(track, regions, durationMs),
    durationMs,
  );
}

export function typingStretches(keys: number[]): Span[] {
  const stretches: Span[] = [];
  for (const ms of keys) {
    const stretch = stretches[stretches.length - 1];
    if (stretch && ms - stretch.endMs < TYPING_GAP_MS) stretch.endMs = ms;
    else stretches.push({ startMs: ms, endMs: ms });
  }
  return stretches.filter(
    ({ startMs, endMs }) => endMs - startMs >= TYPING_MIN_MS,
  );
}

function isFree(regions: Region[], kind: RegionKind, { startMs, endMs }: Span) {
  return (
    endMs > startMs &&
    !regions.some(
      (region) =>
        region.kind === kind &&
        region.startMs < endMs &&
        region.endMs > startMs,
    )
  );
}

export function suggestedSpeeds(
  keys: number[],
  regions: Region[],
  durationMs: number,
): Region[] {
  const added: Region[] = [];
  for (const typed of typingStretches(keys)) {
    const span = { ...typed, endMs: Math.min(durationMs, typed.endMs) };
    if (!isFree(regions, "speed", span)) continue;
    added.push({
      id: nextId([...regions, ...added]),
      kind: "speed",
      ...span,
      amount: REGIONS.speed.amount,
      isSuggested: true,
    });
  }
  return added.length === 0 ? regions : [...regions, ...added];
}

export function steadySpots(spots: CursorMove[]): CursorMove[] {
  if (spots.length === 1) return spots;
  return spots.filter((spot, at) =>
    [-2, -1, 1, 2].some((step) => {
      const other = spots[at + step];
      return (
        other !== undefined &&
        Math.max(Math.abs(spot.x - other.x), Math.abs(spot.y - other.y)) <
          STRAY_SHARE
      );
    }),
  );
}

export function suggestedZooms(
  { clicks, keys, moves, typed }: SuggestionTrack,
  regions: Region[],
  durationMs: number,
): Region[] {
  const lefts = clicks.filter(({ button }) => button === "left");
  const typingAt = (ms: number) =>
    lefts.filter((click) => click.ms <= ms).pop() ?? positionAt(moves, ms);
  const moments = [
    ...lefts.map(({ ms, x, y }) => ({ startMs: ms, endMs: ms, x, y })),
    ...typingStretches(keys).flatMap((stretch) => {
      const [first = typingAt(stretch.startMs), ...rest] = steadySpots(
        typed.filter(
          ({ ms }) => ms > stretch.startMs - 1000 && ms < stretch.endMs + 1000,
        ),
      );
      return [
        { ...stretch, x: first.x, y: first.y },
        ...rest.map(({ ms, x, y }) => ({ startMs: ms, endMs: ms, x, y })),
      ];
    }),
  ].sort((a, b) => a.startMs - b.startMs);
  const groups: { endMs: number; moments: typeof moments }[] = [];
  for (const moment of moments) {
    const group = groups[groups.length - 1];
    if (group && moment.startMs - group.endMs < ZOOM_GROUP_MS) {
      group.moments.push(moment);
      group.endMs = Math.max(group.endMs, moment.endMs);
    } else groups.push({ endMs: moment.endMs, moments: [moment] });
  }
  const { amount } = REGIONS.zoom;
  const added: Region[] = [];
  for (const {
    endMs: lastMs,
    moments: [first, ...rest],
  } of groups) {
    const startMs = Math.max(0, first.startMs - ZOOM_LEAD_MS);
    const span = {
      startMs,
      endMs: Math.min(durationMs, lastMs + ZOOM_HOLD_MS),
    };
    if (!isFree(regions, "zoom", span)) continue;
    const center = centeredOn(first, amount);
    const path: NonNullable<Region["path"]> = [];
    for (const { startMs: ms, x, y } of rest) {
      const from = path[path.length - 1] ?? center;
      const to = centeredOn({ x, y }, amount);
      if (
        Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) <
        MIN_PAN_SHARE
      )
        continue;
      path.push({ afterMs: ms - startMs, ...to });
    }
    added.push({
      id: nextId([...regions, ...added]),
      kind: "zoom",
      ...span,
      amount,
      center,
      path,
      settings: { focus: "Follow cursor" },
      isSuggested: true,
    });
  }
  return added.length === 0 ? regions : [...regions, ...added];
}

export function ringEvents(
  clicks: CursorClick[],
  settings: CursorSettings,
): RingEvent[] {
  const { clickEffect, ringColor, ringSize, ringsRightClicks } =
    plainOr(settings);
  if (clickEffect === "None") return [];
  const style = clickEffect.toLowerCase() as RingStyle;
  return clicks
    .filter(({ button }) => button === "left" || ringsRightClicks)
    .map(({ ms, x, y }) => ({
      ms,
      x,
      y,
      color: MARK_COLORS[ringColor],
      size: ringSize,
      style,
    }));
}

export function ringsAt(rings: RingEvent[], regions: Region[], ms: number) {
  const now = outputAt(regions, ms);
  return rings.flatMap((ring, index) => {
    const playedMs = now - outputAt(regions, ring.ms);
    const step = Math.floor((playedMs / RING_MS) * RING_STEPS);
    return step >= 0 && step < RING_STEPS
      ? [{ index, progress: step / RING_STEPS }]
      : [];
  });
}

export function ringCircles(style: RingStyle, progress: number, size: number) {
  const ring = (at: number) => ({
    radius: (size / 2) * (0.4 + 0.6 * at),
    alpha: 1 - at,
    isFilled: false,
    line: size * 0.08,
  });
  if (style === "pulse") {
    return [
      {
        radius: (size / 2) * (0.3 + 0.7 * progress),
        alpha: 0.5 * (1 - progress),
        isFilled: true,
        line: 0,
      },
    ];
  }
  if (style === "ripple") {
    return [progress, progress - 0.3].filter((at) => at >= 0).map(ring);
  }
  return [ring(progress)];
}

export function exportRings(
  rings: RingEvent[],
  regions: Region[],
  scale: number,
): ExportRing[] {
  return rings.map(({ ms, x, y, color, size, style }) => ({
    t: outputAt(regions, ms) / 1000,
    x,
    y,
    color,
    size: size * scale,
    style,
  }));
}
