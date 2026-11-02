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
} satisfies Record<string, Setting>;
