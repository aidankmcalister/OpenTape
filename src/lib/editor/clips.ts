import { clamp } from "@/lib/geometry";
import {
  amountAt,
  covers,
  gapsBetween,
  MIN_REGION_MS,
  type Region,
  type Span,
  stretched,
} from "./regions";
import { frameStep } from "./timeline";

export type Clip = Span & { id: number };

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
  const clip = kept.find((other) => other.id === id);
  if (!clip) return clips;
  const others = kept.filter((other) => other !== clip);
  const span = stretched(
    clip,
    others,
    edge,
    deltaMs,
    durationMs,
    MIN_REGION_MS,
  );
  if (span.startMs === clip.startMs && span.endMs === clip.endMs) return clips;
  return kept.map((other) => (other === clip ? { ...clip, ...span } : other));
}

export function cutSpans(clips: Clip[], durationMs: number) {
  return gapsBetween(keptClips(clips, durationMs), 0, durationMs);
}

export type TimeMap = ReturnType<typeof timeMap>;

export function timeMap(clips: Clip[], regions: Region[], durationMs: number) {
  const kept = keptClips(clips, durationMs);
  const lastEndMs = kept[kept.length - 1].endMs;
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
  const shown = <T extends Span>(spans: T[]) =>
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
    speedAt: (sourceMs: number) => amountAt(regions, "speed", sourceMs),
    playOn(sourceMs: number, isLooping: boolean) {
      const cut = cutSpans(clips, durationMs).find((span) =>
        covers(span, sourceMs),
      );
      if (!cut || sourceMs === lastEndMs) return null;
      if (cut.startMs < lastEndMs) return { ms: cut.endMs, isEnd: false };
      if (isLooping) return { ms: kept[0].startMs, isEnd: false };
      return { ms: lastEndMs, isEnd: true };
    },
    leap: (sourceMs: number, deltaMs: number) =>
      source(clamp(at(sourceMs) + deltaMs, 0, lengthMs)),
    step(sourceMs: number, frames: number) {
      const next = frameStep(sourceMs, frames, lastEndMs);
      if (kept.some((clip) => covers(clip, next))) return next;
      return source(at(next), frames < 0 ? "end" : "start");
    },
    edit<T extends Span & { id: number }>(
      spans: T[],
      change: (shownSpans: T[], lengthMs: number) => T[],
    ): T[] {
      const before = shown(spans);
      const after = change(before, lengthMs);
      if (after === before) return spans;
      const back = (span: T) => {
        const original = spans.find(({ id }) => id === span.id);
        if (original && before.includes(span)) return original;
        return {
          ...span,
          startMs: source(span.startMs, "start"),
          endMs: source(span.endMs, "end"),
        };
      };
      const has = (list: T[], id: number) =>
        list.some((span) => span.id === id);
      return [
        ...spans.flatMap((span) => {
          if (!has(before, span.id)) return [span];
          const edited = after.find(({ id }) => id === span.id);
          return edited ? [back(edited)] : [];
        }),
        ...after.filter(({ id }) => !has(spans, id)).map(back),
      ];
    },
  };
}

const MIN_KEPT_MS = 500;

export function fitToClips<T extends Span>(spans: T[], clips: Clip[]): T[] {
  if (clips.length === 0) return spans;
  const time = timeMap(clips, [], 0);
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
