import { expect, test } from "bun:test";
import { DEFAULT_SOUND, mixVolumes, stageSound } from "./sound";

test("the stage plays one track at the volume the export mixes it at", () => {
  const sound = { ...DEFAULT_SOUND, microphone: 60, systemAudio: 30 };
  for (const track of ["microphone", "systemAudio"] as const) {
    expect(stageSound(sound, [track]).volume).toBe(mixVolumes(sound)[track]);
  }
});

test("the stage turns off a track at zero and plays the rest at the louder volume", () => {
  const tracks = ["systemAudio", "microphone"] as const;
  const quietMic = { ...DEFAULT_SOUND, microphone: 0, systemAudio: 80 };
  expect(stageSound(quietMic, [...tracks])).toEqual({
    enabled: [true, false],
    volume: 0.8,
  });
  const both = { ...DEFAULT_SOUND, microphone: 50, systemAudio: 20 };
  expect(stageSound(both, [...tracks])).toEqual({
    enabled: [true, true],
    volume: 0.5,
  });
});

test("muting silences the stage, even before the tracks are known", () => {
  const muted = { ...DEFAULT_SOUND, isMuted: true };
  expect(stageSound(muted, ["microphone"])).toEqual({
    enabled: [false],
    volume: 0,
  });
  expect(stageSound(muted, []).volume).toBe(0);
  expect(stageSound(DEFAULT_SOUND, []).volume).toBe(1);
});
