import type { Region, RegionKind, SettingValue } from "./regions";

type Row = [
  RegionKind,
  number,
  number,
  number,
  Record<string, SettingValue>?,
][];

const ROWS: Row[] = [
  [
    ["audio", 0, 4, 0],
    ["zoom", 5, 7.9, 1.7],
    ["zoom", 10.1, 12, 1.4],
  ],
  [
    ["zoom", 1.2, 3.4, 1.5],
    ["captions", 5.4, 9, 0],
    ["audio", 12.2, 14.2, 0, { volume: 60 }],
  ],
  [
    ["annotation", 2.4, 4.4, 0],
    ["speed", 6.2, 8.2, 2],
    ["annotation", 8.6, 10.2, 0, { shape: "Box" }],
    ["speed", 11, 12.8, 2],
  ],
  [
    ["blur", 0.6, 2.4, 0],
    ["highlight", 3, 5, 0],
    ["titleCard", 10.6, 12.4, 0, { title: "Welcome" }],
  ],
  [
    ["clickRing", 1.4, 2.6, 0],
    ["blur", 3.4, 5.2, 0],
    ["highlight", 8.6, 10.2, 0],
    ["clickRing", 11, 12.2, 0],
    ["titleCard", 12.6, 14.2, 0, { title: "Thanks for watching" }],
  ],
];

const BUSY_AT_6_4: Row[] = [
  [],
  [],
  [],
  [["annotation", 5.6, 7.4, 0, { shape: "Box" }]],
  [["speed", 5.8, 7, 2]],
];

const FIXTURE_SECONDS = 14.2;

export const FIXTURES = {
  "18 modifiers": ROWS,
  "20, five busy at 6.4s": ROWS.map((row, index) => [
    ...row,
    ...BUSY_AT_6_4[index],
  ]),
};

export function fixtureRegions(rows: Row[], durationMs: number): Region[] {
  const scale = durationMs / FIXTURE_SECONDS;
  return rows
    .flatMap((row, rowIndex) =>
      row.map(([kind, start, end, amount, settings]) => ({
        kind,
        startMs: start * scale,
        endMs: end * scale,
        amount,
        row: rowIndex,
        settings,
      })),
    )
    .map((region, index) => ({ id: index + 1, ...region }));
}
