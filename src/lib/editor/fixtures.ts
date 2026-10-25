import type { Region, RegionKind } from "./regions";

type Block = [RegionKind, number, number, number];

const FIXTURE_SECONDS = 14.2;

export const FIXTURES: Record<string, Block[]> = {
  "Busy timeline": [
    ["zoom", 1.2, 3.4, 1.5],
    ["zoom", 5, 7.9, 1.7],
    ["zoom", 10.1, 12, 1.4],
    ["speed", 6.2, 8.2, 2],
    ["speed", 11, 12.8, 2],
    ["clickRing", 1.4, 2.6, 0],
    ["clickRing", 4, 5.2, 0],
    ["clickRing", 11, 12.2, 0],
  ],
};

export function fixtureRegions(blocks: Block[], durationMs: number): Region[] {
  const scale = durationMs / FIXTURE_SECONDS;
  return blocks.map(([kind, start, end, amount], index) => ({
    id: index + 1,
    kind,
    startMs: start * scale,
    endMs: end * scale,
    amount,
  }));
}
