import type { ExportBadge } from "@/lib/bindings";
import { clamp, type Rect, type Size } from "@/lib/geometry";
import { KEY_POSITIONS, type KeySettings } from "./appearance";
import {
  covers,
  nextId,
  outputAt,
  type Region,
  sameKind,
  type Setting,
  settingValue,
  type Span,
} from "./regions";

/**
 * A logged key press: when, and its caps with modifiers first, like ["⇧", "⌘", "P"].
 * A key that typed a character is logged as a time alone, so it has no caps.
 */
export type Pressed = { ms: number; caps: string[] };

/** Whether the recording logged which keys were pressed, not only when. */
export function hasCaps(pressed: Pressed[]): boolean {
  return pressed.some(({ caps }) => caps.length > 0);
}

const SHOWN_MS = 1500;
const TYPING_NEAR_MS = 1000;
/** Badges fade in and out this fast. The export's BADGE_FADE_SECONDS matches it. */
const BADGE_FADE_MS = 100;
/** Modifier caps in the order macOS menus show them. */
export const MODIFIER_CAPS = ["⌃", "⌥", "⇧", "⌘"];
const COMMAND_MODIFIERS = "⌃⌥⌘";
const COMMAND_KEYS = ["Esc", "↵", "Tab", "⌫", "⌦", "←", "→", "↑", "↓"];

/** Badge height as a share of the video's height. */
const BADGE_SIZES = { Small: 0.06, Medium: 0.085, Large: 0.11 };

/** The Keystrokes panel: one look for every badge in the recording. */
export const KEY_SETTINGS: Setting[] = [
  {
    kind: "choice",
    key: "size",
    label: "Size",
    options: Object.keys(BADGE_SIZES),
  },
  { kind: "menu", key: "position", label: "Position", options: KEY_POSITIONS },
];

/** Keys pressed with ⌘, ⌃ or ⌥, and keys like Esc and the arrows. ⇧ with a letter is typing. */
export function isShortcut(caps: string[]): boolean {
  const key = caps[caps.length - 1];
  return (
    caps.some((cap) => COMMAND_MODIFIERS.includes(cap)) ||
    COMMAND_KEYS.includes(key)
  );
}

/** ⌘, ⌃ or ⌥ shortcuts and Esc are never typing. */
function isCommand(caps: string[]): boolean {
  return (
    caps.some((cap) => COMMAND_MODIFIERS.includes(cap)) ||
    caps[caps.length - 1] === "Esc"
  );
}

/** Shortcuts always show; ↵, ⌫, Tab and arrows only a second after the previous key. */
function makesBlock(pressed: Pressed[], at: number): boolean {
  const { ms, caps } = pressed[at];
  if (isCommand(caps)) return true;
  const before = pressed[at - 1];
  return isShortcut(caps) && (!before || ms - before.ms >= TYPING_NEAR_MS);
}

/**
 * Each shortcut outside typing becomes a Keystrokes block of 1.5 s, cut short by the next one.
 * The same shortcut pressed again while it shows makes its block longer instead.
 */
export function withShortcuts(
  pressed: Pressed[],
  regions: Region[],
  durationMs: number,
): Region[] {
  const runs: { startMs: number; lastMs: number; text: string }[] = [];
  pressed.forEach(({ ms, caps }, at) => {
    if (ms >= durationMs || !makesBlock(pressed, at)) return;
    const text = caps.join("");
    const run = runs[runs.length - 1];
    if (run?.text === text && ms - run.lastMs < SHOWN_MS) run.lastMs = ms;
    else runs.push({ startMs: ms, lastMs: ms, text });
  });
  const taken = sameKind(regions, "keys");
  const added: Region[] = [];
  runs.forEach(({ startMs, lastMs, text }, at) => {
    const next = runs[at + 1]?.startMs ?? durationMs;
    const span = { startMs, endMs: Math.min(lastMs + SHOWN_MS, next) };
    if (taken.some((t) => t.startMs < span.endMs && t.endMs > span.startMs))
      return;
    added.push({
      id: nextId([...regions, ...added]),
      kind: "keys",
      ...span,
      amount: 0,
      settings: { text },
    });
  });
  return added.length === 0 ? regions : [...regions, ...added];
}

/** The Skipped row starts open when the recording has named keys and none of them makes a block. */
export function opensSkipped(pressed: Pressed[]): boolean {
  return hasCaps(pressed) && withShortcuts(pressed, [], Infinity).length === 0;
}

/** Named keys that aren't on a Keystrokes block, so they can be added by hand. */
export function skippedKeys(pressed: Pressed[], regions: Region[]): Pressed[] {
  const blocks = sameKind(regions, "keys");
  return pressed.filter(
    ({ ms, caps }) =>
      caps.length > 0 && !blocks.some((block) => covers(block, ms)),
  );
}

/** How many presses of its keys a Keystrokes block holds: a joined block shows × 3. */
export function pressCount(pressed: Pressed[], region: Region): number {
  const text = badgeText(region);
  return pressed.filter(
    ({ ms, caps }) => caps.join("") === text && covers(region, ms),
  ).length;
}

/** A run's keys with how many times each was pressed (a block added by hand is once), in the order they first come. */
export function keyCounts(pressed: Pressed[], regions: Region[]) {
  const counts = new Map<string, number>();
  regions.forEach((region) => {
    const text = badgeText(region);
    const count = Math.max(1, pressCount(pressed, region));
    counts.set(text, (counts.get(text) ?? 0) + count);
  });
  return [...counts].map(([text, count]) => ({ text, count }));
}

/** "⇧⌘Page Up" → ["⇧", "⌘", "Page Up"]: each modifier is a cap, the rest is one. */
export function badgeCaps(text: string): string[] {
  const caps: string[] = [];
  let rest = text.trim();
  while (rest && MODIFIER_CAPS.includes(rest[0])) {
    caps.push(rest[0]);
    rest = rest.slice(1).trim();
  }
  return rest ? [...caps, rest] : caps;
}

export function badgeText(region: Region): string {
  return String(settingValue(region, "text"));
}

/** How visible a badge is at `ms`: it fades in at its start and out at its end. */
export function badgeAlpha({ startMs, endMs }: Span, ms: number): number {
  return clamp(Math.min(ms - startMs, endMs - ms) / BADGE_FADE_MS, 0, 1);
}

/** Badges closer than this hand over with a crossfade instead of fading out and back in. */
const CROSSFADE_GAP_MS = 300;

/**
 * When each Keystrokes badge shows: its block, except that a badge starting right after
 * another overlaps it by one fade at the handover, so one fades out as the next fades in.
 */
export function badgeSpans(regions: Region[]): (Span & { region: Region })[] {
  const spans = [...sameKind(regions, "keys")]
    .sort((a, b) => a.startMs - b.startMs)
    .map((region) => ({
      region,
      startMs: region.startMs,
      endMs: region.endMs,
    }));
  spans.slice(1).forEach((span, at) => {
    const before = spans[at];
    const gapMs = span.startMs - before.region.endMs;
    if (gapMs > CROSSFADE_GAP_MS) return;
    const handoverMs = before.region.endMs + gapMs / 2;
    before.endMs = handoverMs + BADGE_FADE_MS / 2;
    span.startMs = handoverMs - BADGE_FADE_MS / 2;
  });
  return spans;
}

type Measure = (text: string, fontPx: number) => number;

/** The badge's parts, in the same units as `height`. */
function badgeShape(caps: string[], height: number, measure: Measure) {
  const pad = height * 0.14;
  const capHeight = height - pad * 2;
  const gap = height * 0.08;
  const fontPx = height * 0.4;
  const widths = caps.map((cap) =>
    Math.max(capHeight, measure(cap, fontPx) + height * 0.44),
  );
  const width =
    pad * 2 +
    widths.reduce((sum, w) => sum + w, 0) +
    gap * Math.max(0, caps.length - 1);
  return { width, pad, capHeight, gap, fontPx, widths };
}

/** Where a badge sits inside the recording, half its height in from the edges. */
export function badgeRect(
  text: string,
  { size, position }: KeySettings,
  recording: Rect,
  videoHeight: number,
  measure: Measure,
): Rect | null {
  const caps = badgeCaps(text);
  if (caps.length === 0) return null;
  // A badge too wide for the recording (a narrow window, long keys) shrinks to fit.
  const wanted = BADGE_SIZES[size] * videoHeight;
  const wantedWidth = badgeShape(caps, wanted, measure).width + wanted;
  const height = wanted * Math.min(1, recording.width / wantedWidth);
  const { width } = badgeShape(caps, height, measure);
  const margin = height * 0.5;
  const [row, column] = position.split(" ");
  const x =
    column === "left"
      ? recording.x + margin
      : column === "right"
        ? recording.x + recording.width - margin - width
        : recording.x + (recording.width - width) / 2;
  const y =
    row === "Top"
      ? recording.y + margin
      : recording.y + recording.height - margin - height;
  return { x, y, width, height };
}

const FONT = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";

export function canvasMeasure(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  return (text, fontPx) => {
    if (!context) return text.length * fontPx * 0.6;
    context.font = `600 ${fontPx}px ${FONT}`;
    return context.measureText(text).width;
  };
}

/** Draws a badge filling `size` (pixels): a dark pill with one keycap per cap. */
export function drawBadge(
  context: CanvasRenderingContext2D,
  text: string,
  size: Size,
) {
  const caps = badgeCaps(text);
  const height = size.height;
  const measure: Measure = (cap, fontPx) => {
    context.font = `600 ${fontPx}px ${FONT}`;
    return context.measureText(cap).width;
  };
  const { pad, capHeight, gap, fontPx, widths } = badgeShape(
    caps,
    height,
    measure,
  );
  context.clearRect(0, 0, size.width, size.height);
  context.beginPath();
  context.roundRect(0, 0, size.width, height, height * 0.3);
  context.fillStyle = "rgb(24 24 27 / 0.97)";
  context.fill();
  // The edge line sits fully inside the pill; centered on the edge, its outer half was cut off.
  const line = Math.max(1, height * 0.02);
  context.beginPath();
  context.roundRect(
    line / 2,
    line / 2,
    size.width - line,
    height - line,
    height * 0.3 - line / 2,
  );
  context.lineWidth = line;
  context.strokeStyle = "rgb(255 255 255 / 0.12)";
  context.stroke();
  context.font = `600 ${fontPx}px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  let x = pad;
  caps.forEach((cap, at) => {
    context.beginPath();
    context.roundRect(x, pad, widths[at], capHeight, height * 0.18);
    context.fillStyle = "rgb(255 255 255 / 0.14)";
    context.fill();
    context.fillStyle = "white";
    context.fillText(cap, x + widths[at] / 2, pad + capHeight / 2);
    x += widths[at] + gap;
  });
}

/** The badge as base64 PNG, for the export. */
function badgePicture(text: string, size: Size): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size.width);
  canvas.height = Math.ceil(size.height);
  const context = canvas.getContext("2d");
  if (context) drawBadge(context, text, size);
  return canvas.toDataURL("image/png").split(",")[1];
}

/** Each Keys block's badge as a picture placed in the export, in output seconds and pixels. */
export function exportBadges(
  regions: Region[],
  settings: KeySettings,
  recording: Rect,
  videoHeight: number,
): ExportBadge[] {
  const spans = badgeSpans(regions);
  if (spans.length === 0) return [];
  const measure = canvasMeasure();
  return spans.flatMap(({ region, startMs, endMs }) => {
    const text = badgeText(region);
    const rect = badgeRect(text, settings, recording, videoHeight, measure);
    if (!rect) return [];
    return {
      start: outputAt(regions, startMs) / 1000,
      end: outputAt(regions, endMs) / 1000,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      png: badgePicture(text, rect),
    };
  });
}
