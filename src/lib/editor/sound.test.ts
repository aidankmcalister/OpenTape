import { expect, test } from "bun:test";
import { readSound, soundPeaks, soundVolumes, waveform } from "./sound";

test("soundVolumes turns each track's Mute and Volume into a level from 0 to 1", () => {
  expect(
    soundVolumes({
      systemAudio: { isMuted: false, volume: 25 },
      microphone: { isMuted: true, volume: 100 },
    }),
  ).toEqual({ systemAudio: 0.25, microphone: 0 });
});

test("readSound fills in a track the project doesn't mention", () => {
  const microphone = { isMuted: true, volume: 50 };
  expect(readSound({ microphone })).toEqual({
    systemAudio: { isMuted: false, volume: 100 },
    microphone,
  });
});

test("soundPeaks keeps the loudest sample of each 10 ms across both channels", () => {
  const left = new Float32Array(2000);
  const right = new Float32Array(2000);
  left[10] = -0.5;
  right[150] = 0.8;
  right[1999] = 0.1;
  const peaks = soundPeaks([left, right], 10_000);
  expect(Array.from(peaks)).toEqual([
    0.5,
    0.800000011920929,
    ...Array(17).fill(0),
    0.10000000149011612,
  ]);
});

test("waveform skips the parts that were cut", () => {
  // Loud from 0 to 100 ms and from 300 to 400 ms; 100 to 300 ms was cut.
  const peaks = new Float32Array(40);
  peaks.fill(1, 0, 10);
  peaks.fill(0.25, 30, 40);
  const sourceAt = (ms: number) => (ms < 100 ? ms : ms + 200);
  expect(waveform(peaks, 4, 200, sourceAt)).toEqual([1, 1, 0.5, 0.5]);
});
