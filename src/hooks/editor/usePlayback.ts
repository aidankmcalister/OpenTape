import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VideoTrack } from "@/lib/bindings";
import type { TimeMap } from "@/lib/editor/clips";
import {
  createFrames,
  type Frames,
  fillChannels,
  SOUND_RATE,
  soundParts,
} from "@/lib/editor/playback";
import type { SoundSettings } from "@/lib/editor/sound";
import type { Size } from "@/lib/geometry";
import { type Clock, createClock } from "@/lib/time";

type Loaded = { frames: Frames<VideoFrame>; size: Size; durationMs: number };

export function usePlayback(src: string, loops = false) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(loops);
  const [isMuted, setIsMuted] = useState(false);
  const [heldMs, setHeldMs] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [clock] = useState(createClock);
  const held = useRef<number | null>(null);

  useEffect(() => {
    let isLive = true;
    let frames: Loaded["frames"] | null = null;
    invoke<VideoTrack>("video_track")
      .then((track) => {
        if (!isLive) return;
        frames = createFrames<VideoFrame>(
          track.samples,
          (from, to) => invoke<ArrayBuffer>("video_samples", { from, to }),
          (output, ready) => videoDecoder(track, output, ready),
        );
        setLoaded({
          frames,
          size: { width: track.width, height: track.height },
          durationMs: track.durationMs,
        });
      })
      .catch(console.error);
    return () => {
      isLive = false;
      frames?.close();
    };
  }, [src]);

  function hold(ms: number | null) {
    held.current = ms;
    setHeldMs(ms);
  }

  function seek(ms: number) {
    hold(null);
    clock.set(ms / 1000);
  }

  function skim(ms: number | null) {
    if (ms === null) {
      if (held.current !== null) seek(held.current);
    } else if (!isPlaying) {
      if (held.current === null) hold(clock.seconds() * 1000);
      clock.set(ms / 1000);
    }
  }

  const videoSize = loaded?.size ?? null;
  return {
    isPlaying,
    isLooping,
    isMuted,
    durationMs: loaded?.durationMs ?? 0,
    ratio: videoSize?.height ? videoSize.width / videoSize.height : 16 / 9,
    videoSize,
    frames: loaded?.frames ?? null,
    clock,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    seek,
    skim,
    heldMs,
    toggleLoop: () => setIsLooping((isOn) => !isOn),
    toggleSound: () => setIsMuted((isOn) => !isOn),
    speed,
    setSpeed,
  };
}

export type Playback = ReturnType<typeof usePlayback>;

export function useTimeMap(playback: Playback, time: TimeMap) {
  const { isPlaying, clock, seek, play, pause } = playback;
  const advance = useEffectEvent((elapsedMs: number) => {
    if (time.outputMs <= 0) return;
    const ms =
      time.outputAt(clock.seconds() * 1000) + elapsedMs * playback.speed;
    if (ms < time.outputMs) return clock.set(time.sourceAt(ms) / 1000);
    if (playback.isLooping)
      return clock.set(time.sourceAt(ms % time.outputMs) / 1000);
    pause();
    clock.set(time.sourceAt(time.outputMs) / 1000);
  });
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      advance(Math.max(0, now - last));
      last = now;
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);
  return {
    togglePlay: () => {
      playback.skim(null);
      if (isPlaying) return pause();
      if (time.outputAt(clock.seconds() * 1000) >= time.outputMs)
        seek(time.source(0));
      play();
    },
    toStart: () => seek(time.source(0)),
    toEnd: () => seek(time.source(time.lengthMs)),
    step: (frames: number) => {
      pause();
      seek(time.step(clock.seconds() * 1000, frames));
    },
    leap: (ms: number) => seek(time.leap(clock.seconds() * 1000, ms)),
  };
}

const DRIFT_MS = 150;

export function useStageSound(
  { clock, isPlaying, isMuted, speed }: Playback,
  time: TimeMap,
  sound: SoundSettings,
) {
  const [loaded, setLoaded] = useState<{
    context: AudioContext;
    buffer: AudioBuffer;
  } | null>(null);
  useEffect(() => {
    const context = new AudioContext();
    invoke<ArrayBuffer>("stage_sound")
      .then((pcm) => {
        const length = pcm.byteLength / 4;
        if (length === 0 || context.state === "closed") return;
        const buffer = context.createBuffer(2, length, SOUND_RATE);
        fillChannels(pcm, [buffer.getChannelData(0), buffer.getChannelData(1)]);
        setLoaded({ context, buffer });
      })
      .catch(console.error);
    return () => void context.close();
  }, []);

  const start = useEffectEvent((context: AudioContext, buffer: AudioBuffer) => {
    const fromMs = time.outputAt(clock.seconds() * 1000);
    const startedAt = context.currentTime;
    const nodes = soundParts(time.pieces, fromMs, speed).map((part) => {
      const node = new AudioBufferSourceNode(context, {
        buffer,
        playbackRate: part.rate,
      });
      node.connect(context.destination);
      node.start(
        startedAt + part.waitMs / 1000,
        part.offsetMs / 1000,
        part.lengthMs / 1000,
      );
      return node;
    });
    return {
      stop: () => nodes.forEach((node) => node.stop()),
      hasDrifted: () => {
        const heardMs =
          fromMs + (context.currentTime - startedAt) * 1000 * speed;
        const shownMs = time.outputAt(clock.seconds() * 1000);
        return (
          context.state === "running" && Math.abs(heardMs - shownMs) > DRIFT_MS
        );
      },
    };
  });
  const pieces = JSON.stringify(time.pieces);
  const isHeard = isPlaying && !isMuted && !sound.isMuted;
  useEffect(() => {
    if (!isHeard || !loaded) return;
    const { context, buffer } = loaded;
    void context.resume();
    let playing = start(context, buffer);
    const unsubscribe = clock.subscribe(() => {
      if (!playing.hasDrifted()) return;
      playing.stop();
      playing = start(context, buffer);
    });
    return () => {
      unsubscribe();
      playing.stop();
    };
  }, [isHeard, loaded, clock, speed, pieces]);
}

export function useClockValue<T>(
  clock: Clock,
  select: (seconds: number) => T,
): T {
  const last = useRef<{ value: T; json: string } | null>(null);
  return useSyncExternalStore(clock.subscribe, () => {
    const value = select(clock.seconds());
    const json = JSON.stringify(value);
    if (last.current && last.current.json === json) return last.current.value;
    last.current = { value, json };
    return value;
  });
}

function videoDecoder(
  track: VideoTrack,
  output: (frame: VideoFrame) => void,
  ready: () => void,
) {
  const config = {
    codec: track.codec,
    description: new Uint8Array(track.description),
  };
  const open = () => {
    const decoder = new VideoDecoder({ output, error: console.error });
    decoder.addEventListener("dequeue", ready);
    decoder.configure(config);
    return decoder;
  };
  let decoder = open();
  return {
    decode: (chunk: EncodedVideoChunkInit) => {
      if (decoder.state === "configured")
        decoder.decode(new EncodedVideoChunk(chunk));
    },
    flush: () => decoder.flush(),
    reset: () => {
      if (decoder.state === "closed") decoder = open();
      else {
        decoder.reset();
        decoder.configure(config);
      }
    },
    close: () => {
      if (decoder.state !== "closed") decoder.close();
    },
  };
}
