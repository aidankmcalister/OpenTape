import type { Setting } from "./regions";

export type SoundSettings = { isMuted: boolean };

export const DEFAULT_SOUND: SoundSettings = { isMuted: false };

export const SOUND_SETTINGS = {
  isMuted: {
    kind: "switch",
    key: "isMuted",
    label: "Mute",
    help: "Plays and exports with no sound. The speaker under the stage only mutes playback.",
  },
  microphone: {
    kind: "slider",
    key: "microphone",
    label: "Microphone",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  systemAudio: {
    kind: "slider",
    key: "systemAudio",
    label: "System audio",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
} satisfies Record<string, Setting>;
