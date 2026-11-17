import { clamp } from "@/lib/geometry";
import {
  amountAt,
  covers,
  gapsBetween,
  MIN_REGION_MS,
  type Region,
  sameKind,
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

/** Joins the clip `afterId` onto the one before it, bringing back the footage between them. */
export function restoreCut(clips: Clip[], afterId: number): Clip[] {
  const index = clips.findIndex(({ id }) => id === afterId);
  if (index < 1) return clips;
  const before = clips[index - 1];
  return clips.flatMap((clip, at) => {
    if (at === index) return [];
    return at === index - 1
      ? [{ ...before, endMs: clips[index].endMs }]
      : [clip];
  });
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
  const edges = sameKind(regions, "speed").flatMap(({ startMs, endMs }) => [
    startMs,
    endMs,
  ]);
  let outputMs = 0;
  const pieces = kept.flatMap(({ startMs, endMs }) => {
    const cuts = [startMs, endMs, ...edges]
      .filter((ms) => ms >= startMs && ms <= endMs)
      .sort((a, b) => a - b);
    return cuts.slice(1).flatMap((end, index) => {
      const start = cuts[index];
      if (end <= start) return [];
      const rate = amountAt(regions, "speed", start);
      const at = outputMs;
      outputMs += (end - start) / rate;
      return [{ startMs: start, endMs: end, rate, at }];
    });
  });
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
    cuts: placed.slice(1).map(({ clip, at: atMs }, index) => {
      const before = placed[index].clip;
      return {
        atMs,
        removedMs: clip.startMs - before.endMs,
        beforeId: before.id,
        afterId: clip.id,
      };
    }),
    at,
    source,
    shown,
    outputMs,
    pieces,
    outputAt(sourceMs: number) {
      const piece = pieces.find(({ endMs }) => endMs > sourceMs);
      if (!piece) return outputMs;
      return piece.at + Math.max(0, sourceMs - piece.startMs) / piece.rate;
    },
    sourceAt(ms: number) {
      const piece =
        pieces.find(
          ({ startMs, endMs, rate, at }) => ms < at + (endMs - startMs) / rate,
        ) ?? pieces[pieces.length - 1];
      if (!piece) return 0;
      return Math.min(
        piece.startMs + (ms - piece.at) * piece.rate,
        piece.endMs,
      );
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

/**
 * Edits in kept time never see blocks hidden in removed footage, so a block can land on one.
 * On Restore, a hidden block now overlapping a block of its kind keeps the longest free part
 * of its span, or goes when that's under the minimum.
 */
export function fitHidden(
  regions: Region[],
  clips: Clip[],
  durationMs: number,
): Region[] {
  const shown = timeMap(clips, regions, durationMs).shown(regions);
  const fitted = regions.flatMap((region) => {
    if (shown.some(({ id }) => id === region.id)) return [region];
    const blockers = sameKind(regions, region.kind).filter(
      (other) =>
        other !== region &&
        other.startMs < region.endMs &&
        other.endMs > region.startMs,
    );
    if (blockers.length === 0) return [region];
    const [free] = gapsBetween(blockers, region.startMs, region.endMs).sort(
      (a, b) => b.endMs - b.startMs - (a.endMs - a.startMs),
    );
    return free && free.endMs - free.startMs >= MIN_REGION_MS
      ? [{ ...region, ...free }]
      : [];
  });
  return fitted.length === regions.length &&
    fitted.every((region, at) => region === regions[at])
    ? regions
    : fitted;
}
