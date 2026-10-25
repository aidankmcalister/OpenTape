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
  return kept
    .filter(
      (clip, index) => index > 0 && clip.startMs === kept[index - 1].endMs,
    )
    .map(({ startMs }) => startMs);
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
