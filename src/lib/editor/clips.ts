import { clamp } from "@/lib/geometry";
import { dragSpan, MIN_REGION_MS } from "./regions";

export type Clip = { id: number; startMs: number; endMs: number };

export function keptClips(clips: Clip[], durationMs: number): Clip[] {
  return clips.length > 0 ? clips : [{ id: 1, startMs: 0, endMs: durationMs }];
}

export function splitClip(
  clips: Clip[],
  atMs: number,
  durationMs: number,
): Clip[] {
  const kept = keptClips(clips, durationMs);
  const clip = kept.find(
    ({ startMs, endMs }) =>
      atMs - startMs >= MIN_REGION_MS && endMs - atMs >= MIN_REGION_MS,
  );
  if (!clip) return clips;
  const id = Math.max(...kept.map((other) => other.id)) + 1;
  return kept.flatMap((other) =>
    other === clip
      ? [
          { ...clip, endMs: atMs },
          { id, startMs: atMs, endMs: clip.endMs },
        ]
      : [other],
  );
}

export function clipSeams(kept: Clip[]): number[] {
  return kept.slice(1).map(({ startMs }) => startMs);
}

export function removeClip(
  clips: Clip[],
  id: number,
  durationMs: number,
): Clip[] {
  const kept = keptClips(clips, durationMs);
  if (kept.length < 2 || !kept.some((clip) => clip.id === id)) return clips;
  return kept.filter((clip) => clip.id !== id);
}

export function trimClip(
  clips: Clip[],
  id: number,
  edge: "start" | "end",
  deltaMs: number,
  durationMs: number,
): Clip[] {
  const kept = keptClips(clips, durationMs);
  const trimmed = dragSpan(kept, id, edge, deltaMs, durationMs);
  return trimmed === kept ? clips : trimmed;
}

export function cutSpans(clips: Clip[], durationMs: number) {
  const edges = [
    0,
    ...keptClips(clips, durationMs).flatMap(({ startMs, endMs }) => [
      startMs,
      endMs,
    ]),
    durationMs,
  ];
  const cuts: { startMs: number; endMs: number }[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i + 1] > edges[i]) {
      cuts.push({ startMs: edges[i], endMs: edges[i + 1] });
    }
  }
  return cuts;
}

export function cutEndAt(
  clips: Clip[],
  ms: number,
  durationMs: number,
): number | null {
  const cut = cutSpans(clips, durationMs).find(
    ({ startMs, endMs }) => ms >= startMs && ms < endMs,
  );
  return cut?.endMs ?? null;
}

export type KeptTime = ReturnType<typeof keptTime>;

export function keptTime(clips: Clip[], durationMs: number) {
  const kept = keptClips(clips, durationMs);
  let lengthMs = 0;
  const placed = kept.map((clip) => {
    const at = lengthMs;
    lengthMs += clip.endMs - clip.startMs;
    return { clip, at, endAt: lengthMs };
  });
  const at = (sourceMs: number) => {
    const next = placed.find(({ clip }) => clip.endMs > sourceMs);
    if (!next) return lengthMs;
    return next.at + Math.max(0, sourceMs - next.clip.startMs);
  };
  const source = (ms: number, side: "start" | "end" = "start") => {
    const piece =
      placed.find(({ endAt }) =>
        side === "start" ? ms < endAt : ms <= endAt,
      ) ?? placed[placed.length - 1];
    return clamp(
      piece.clip.startMs + ms - piece.at,
      piece.clip.startMs,
      piece.clip.endMs,
    );
  };
  const shown = <T extends { startMs: number; endMs: number }>(spans: T[]) =>
    spans
      .map((span) => ({
        ...span,
        startMs: at(span.startMs),
        endMs: at(span.endMs),
      }))
      .filter(({ startMs, endMs }) => endMs > startMs);
  return {
    lengthMs,
    clips: placed.map(({ clip, at: startMs, endAt }) => ({
      ...clip,
      startMs,
      endMs: endAt,
    })),
    at,
    source,
    shown,
    edit<T extends { id: number; startMs: number; endMs: number }>(
      spans: T[],
      change: (shownSpans: T[], lengthMs: number) => T[],
    ): T[] {
      const before = shown(spans);
      const after = change(before, lengthMs);
      if (after === before) return spans;
      const hidden = spans.filter(
        ({ id }) => !before.some((span) => span.id === id),
      );
      return [
        ...after.map((span) => {
          const original = spans.find(({ id }) => id === span.id);
          if (original && before.includes(span)) return original;
          return {
            ...span,
            startMs: source(span.startMs, "start"),
            endMs: source(span.endMs, "end"),
          };
        }),
        ...hidden,
      ];
    },
  };
}

export const MIN_KEPT_MS = 500;

export function fitToClips<T extends { startMs: number; endMs: number }>(
  spans: T[],
  clips: Clip[],
): T[] {
  if (clips.length === 0) return spans;
  const time = keptTime(clips, 0);
  const fitted = spans.flatMap((span) => {
    const startMs = time.at(span.startMs);
    const endMs = time.at(span.endMs);
    if (endMs - startMs < Math.min(MIN_KEPT_MS, span.endMs - span.startMs))
      return [];
    const fit = {
      startMs: time.source(startMs, "start"),
      endMs: time.source(endMs, "end"),
    };
    return fit.startMs === span.startMs && fit.endMs === span.endMs
      ? [span]
      : [{ ...span, ...fit }];
  });
  return fitted.every((span, index) => span === spans[index]) &&
    fitted.length === spans.length
    ? spans
    : fitted;
}
