import type { ExportSound, SoundTrack } from "@/lib/bindings";
import type { Setting } from "./regions";

export type SoundSettings = Record<SoundTrack, number> & { isMuted: boolean };

export const DEFAULT_SOUND: SoundSettings = {
  isMuted: false,
  microphone: 100,
  systemAudio: 100,
};

export const SOUND_SETTINGS = {
  isMuted: {
    kind: "switch",
    key: "isMuted",
    label: "Mute",
    help: "Plays and exports with no sound. The speaker under the stage only quiets playback here.",
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
} satisfies Record<keyof SoundSettings, Setting>;

export function mixVolumes(sound: SoundSettings): ExportSound {
  const gain = (track: SoundTrack) => (sound.isMuted ? 0 : sound[track] / 100);
  return { microphone: gain("microphone"), systemAudio: gain("systemAudio") };
}

export function stageSound(sound: SoundSettings, tracks: SoundTrack[]) {
  const mix = mixVolumes(sound);
  const volumes = tracks.map((track) => mix[track]);
  return {
    enabled: volumes.map((volume) => volume > 0),
    volume:
      tracks.length === 0 ? (sound.isMuted ? 0 : 1) : Math.max(...volumes),
  };
}
