import type { ExportSound, SoundTrack } from "@/lib/bindings";
import type { Setting } from "./regions";

export type TrackSound = { isMuted: boolean; volume: number };

export type SoundSettings = Record<SoundTrack, TrackSound>;

const AS_RECORDED: TrackSound = { isMuted: false, volume: 100 };

export const DEFAULT_SOUND: SoundSettings = {
  systemAudio: AS_RECORDED,
  microphone: AS_RECORDED,
};

export const SOUND_TRACKS: { track: SoundTrack; title: string }[] = [
  { track: "systemAudio", title: "System audio" },
  { track: "microphone", title: "Microphone" },
];

export const TRACK_SETTINGS = [
  { kind: "switch", key: "isMuted", label: "Mute" },
  {
    kind: "slider",
    key: "volume",
    label: "Volume",
    min: 1,
    max: 100,
    step: 1,
    unit: "%",
  },
] satisfies Setting[];

/** How loud each track plays, from 0 (muted) to 1 (as recorded). */
export function soundVolumes(sound: SoundSettings): ExportSound {
  const volume = ({ isMuted, volume }: TrackSound) =>
    isMuted ? 0 : volume / 100;
  return {
    systemAudio: volume(sound.systemAudio),
    microphone: volume(sound.microphone),
  };
}

/** A saved project's sound. Projects from before 0.2.0 had one Mute for the whole recording. */
export function readSound(
  saved: Partial<SoundSettings> & { isMuted?: boolean } = {},
): SoundSettings {
  const track = (part?: Partial<TrackSound>): TrackSound => ({
    isMuted: part?.isMuted ?? saved.isMuted ?? false,
    volume: part?.volume ?? 100,
  });
  return {
    systemAudio: track(saved.systemAudio),
    microphone: track(saved.microphone),
  };
}

/** How finely a track's loudness is kept for drawing: one peak per 10 ms. */
export const PEAK_MS = 10;

/** The loudest sample in each 10 ms of a track, from 0 to 1, across its channels. */
export function soundPeaks(channels: Float32Array[], rate: number) {
  const size = (rate * PEAK_MS) / 1000;
  const peaks = new Float32Array(Math.ceil(channels[0].length / size));
  for (const samples of channels)
    for (let index = 0; index < samples.length; index++) {
      const bucket = Math.floor(index / size);
      peaks[bucket] = Math.max(peaks[bucket], Math.abs(samples[index]));
    }
  return peaks;
}

/**
 * Bar heights from 0 to 1 for `columns` even slices of a timeline `timelineMs` long. `sourceAt`
 * turns timeline time into recording time, so the parts that were cut are skipped. Heights use
 * the square root so quiet speech still shows.
 */
export function waveform(
  peaks: Float32Array,
  columns: number,
  timelineMs: number,
  sourceAt: (ms: number) => number,
) {
  const sliceMs = timelineMs / columns;
  return Array.from({ length: columns }, (_, column) => {
    const fromMs = sourceAt(column * sliceMs);
    const first = Math.floor(fromMs / PEAK_MS);
    const last = Math.max(first + 1, Math.ceil((fromMs + sliceMs) / PEAK_MS));
    let peak = 0;
    for (let index = first; index < Math.min(last, peaks.length); index++)
      peak = Math.max(peak, peaks[index]);
    return Math.sqrt(peak);
  });
}
