import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYS, type KeySettings } from "./appearance";
import {
  badgeAlpha,
  badgeCaps,
  badgeRect,
  badgeSpans,
  isShortcut,
  keyCounts,
  pressCount,
  withShortcuts,
  hasCaps,
} from "./keys";
import type { Region } from "./regions";

const measure = (text: string, fontPx: number) => text.length * fontPx * 0.6;

describe("keys", () => {
  test("shortcuts use ⌘, ⌃ or ⌥, or a key like Esc; ⇧ with a letter is typing", () => {
    expect(isShortcut(["⌘", "K"])).toBe(true);
    expect(isShortcut(["⇧", "⌘", "P"])).toBe(true);
    expect(isShortcut(["Esc"])).toBe(true);
    expect(isShortcut(["⇧", "A"])).toBe(false);
    expect(isShortcut(["A"])).toBe(false);
  });

  test("each shortcut becomes a Keys block of 1.5 s, cut short by the next one", () => {
    const regions = withShortcuts(
      [
        { ms: 1000, caps: ["⌘", "K"] },
        { ms: 1200, caps: ["H"] },
        { ms: 1500, caps: ["⇧", "⌘", "P"] },
        { ms: 9000, caps: ["Esc"] },
      ],
      [],
      10_000,
    );
    expect(
      regions.map(({ kind, startMs, endMs, settings }) => [
        kind,
        startMs,
        endMs,
        settings?.text,
      ]),
    ).toEqual([
      ["keys", 1000, 1500, "⌘K"],
      ["keys", 1500, 3000, "⇧⌘P"],
      ["keys", 9000, 10_000, "Esc"],
    ]);
  });

  test("shortcuts skip spots where a Keys block already is", () => {
    const kept: Region = {
      id: 1,
      kind: "keys",
      startMs: 900,
      endMs: 1400,
      amount: 0,
      settings: { text: "⌘S" },
    };
    const regions = withShortcuts(
      [{ ms: 1000, caps: ["⌘", "K"] }],
      [kept],
      10_000,
    );
    expect(regions).toEqual([kept]);
  });

  test("each modifier is its own cap, and the rest is one", () => {
    expect(badgeCaps("⇧⌘P")).toEqual(["⇧", "⌘", "P"]);
    expect(badgeCaps("⌘Page Up")).toEqual(["⌘", "Page Up"]);
    expect(badgeCaps("Esc")).toEqual(["Esc"]);
    expect(badgeCaps("  ")).toEqual([]);
  });

  test("the badge sits half its height in from the chosen edges", () => {
    const recording = { x: 100, y: 50, width: 1600, height: 900 };
    const place = (position: KeySettings["position"]) =>
      badgeRect("⌘K", { size: "Medium", position }, recording, 1000, measure)!;
    const bottom = place("Bottom center");
    expect(bottom.height).toBe(85);
    expect(bottom.y).toBe(50 + 900 - 42.5 - 85);
    expect(bottom.x + bottom.width / 2).toBeCloseTo(100 + 800);
    expect(place("Top left")).toMatchObject({ x: 142.5, y: 92.5 });
    const right = place("Top right");
    expect(right.x + right.width).toBeCloseTo(100 + 1600 - 42.5);
    expect(badgeRect("", DEFAULT_KEYS, recording, 1000, measure)).toBeNull();
  });

  test("a badge fades in at its start and out at its end", () => {
    const span = { startMs: 1000, endMs: 2500 };
    expect(badgeAlpha(span, 1000)).toBe(0);
    expect(badgeAlpha(span, 1050)).toBeCloseTo(0.5);
    expect(badgeAlpha(span, 1800)).toBe(1);
    expect(badgeAlpha(span, 2500)).toBe(0);
  });

  test("↵, ⌫ and arrows next to typing are typing; alone, or as ⌘ shortcuts, they're badges", () => {
    const at = (ms: number, ...caps: string[]) => ({ ms, caps });
    const regions = withShortcuts(
      [
        at(1000, "H"),
        at(1300, "I"),
        at(1600, "↵"),
        at(1700, "⌘", "S"),
        at(5000, "↓"),
        at(9000, "⌫"),
      ],
      [],
      10_000,
    );
    expect(regions.map(({ settings }) => settings?.text)).toEqual([
      "⌘S",
      "↓",
      "⌫",
    ]);
  });

  test("↵, ⌫, Tab and arrows make a block only a second after the previous key", () => {
    const at = (ms: number, ...caps: string[]) => ({ ms, caps });
    const regions = withShortcuts(
      [
        at(1000, "⌘", "S"),
        at(1400, "↵"),
        at(4000, "Tab"),
        at(4300, "H"),
        at(7000, "←"),
      ],
      [],
      10_000,
    );
    expect(regions.map(({ settings }) => settings?.text)).toEqual([
      "⌘S",
      "Tab",
      "←",
    ]);
  });

  test("a ↵ typed inside text never joins an earlier ↵ block", () => {
    const at = (ms: number, ...caps: string[]) => ({ ms, caps });
    const regions = withShortcuts(
      [at(1000, "↵"), at(2000), at(2200, "↵")],
      [],
      10_000,
    );
    expect(regions.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [1000, 2500],
    ]);
  });

  test("the same shortcut pressed again while it shows makes one longer block", () => {
    const pressed = [
      { ms: 1000, caps: ["⌘", "Z"] },
      { ms: 1400, caps: ["⌘", "Z"] },
      { ms: 2000, caps: ["⌘", "Z"] },
      { ms: 6000, caps: ["⌘", "Z"] },
    ];
    const regions = withShortcuts(pressed, [], 10_000);
    expect(regions.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [1000, 3500],
      [6000, 7500],
    ]);
    expect(regions.map((region) => pressCount(pressed, region))).toEqual([
      3, 1,
    ]);
  });

  test("a run counts presses per key across its blocks, in the order they first come", () => {
    const keys = (startMs: number, text: string): Region => ({
      id: startMs,
      kind: "keys",
      startMs,
      endMs: startMs + 1000,
      amount: 0,
      settings: { text },
    });
    const at = (ms: number, ...caps: string[]) => ({ ms, caps });
    const pressed = [
      at(0, "⌘", "Z"),
      at(400, "⌘", "Z"),
      at(800, "⌘", "Z"),
      at(1000, "⌘", "S"),
      at(2000, "⌘", "Z"),
    ];
    // A block added by hand holds no press, and still counts once.
    expect(
      keyCounts(pressed, [
        keys(0, "⌘Z"),
        keys(1000, "⌘S"),
        keys(2000, "⌘Z"),
        keys(5000, "⌘S"),
      ]),
    ).toEqual([
      { text: "⌘Z", count: 4 },
      { text: "⌘S", count: 2 },
    ]);
  });

  test("typed characters come without caps: they make typing, and are never badges; ↵ in typing makes none", () => {
    const pressed = [
      { ms: 1000, caps: [] },
      { ms: 1200, caps: [] },
      { ms: 1400, caps: ["↵"] },
      { ms: 5000, caps: ["↵"] },
      { ms: 8000, caps: [] },
    ];
    const added = withShortcuts(pressed, [], 10_000);
    expect(added.map(({ startMs }) => startMs)).toEqual([5000]);
    expect(hasCaps(pressed)).toBe(true);
    expect(hasCaps([{ ms: 1000, caps: [] }])).toBe(false);
  });

  test("badges right after each other crossfade at the handover; farther apart they don't", () => {
    const keys = (id: number, startMs: number, endMs: number): Region => ({
      id,
      kind: "keys",
      startMs,
      endMs,
      amount: 0,
    });
    const spans = badgeSpans([
      keys(2, 2000, 3500),
      keys(1, 500, 2000),
      keys(3, 5000, 6000),
    ]);
    expect(spans.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [500, 2050],
      [1950, 3500],
      [5000, 6000],
    ]);
    const gapped = badgeSpans([keys(1, 0, 1000), keys(2, 1200, 2000)]);
    expect(gapped[0].endMs).toBe(1150);
    expect(gapped[1].startMs).toBe(1050);
  });

  test("a badge too wide for the recording shrinks to fit inside it", () => {
    const narrow = { x: 0, y: 0, width: 300, height: 1000 };
    const rect = badgeRect(
      "⌃⌥⇧⌘Page Down",
      DEFAULT_KEYS,
      narrow,
      1000,
      measure,
    )!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(300);
    const wide = { x: 0, y: 0, width: 1600, height: 1000 };
    expect(badgeRect("⌘K", DEFAULT_KEYS, wide, 1000, measure)!.height).toBe(85);
  });
});
