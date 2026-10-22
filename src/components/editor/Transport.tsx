import {
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import type { Playback } from "@/hooks/editor/usePlayback";
import { useClockValue } from "@/hooks/useVideoClock";
import { formatTime, type Clock } from "@/lib/time";
import Island from "./Island";

export default function Transport({ playback }: { playback: Playback }) {
  return (
    <Island className="flex h-12 shrink-0 items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Back to the start"
        onClick={playback.toStart}
      >
        <SkipBack />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={playback.isPlaying ? "Pause" : "Play"}
        onClick={playback.togglePlay}
      >
        {playback.isPlaying ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Skip to the end"
        onClick={playback.toEnd}
      >
        <SkipForward />
      </Button>
      <TimeReadout clock={playback.clock} durationMs={playback.durationMs} />
      <Separator orientation="vertical" className="mx-2 my-3" />
      <Toggle
        aria-label="Loop"
        pressed={playback.isLooping}
        onPressedChange={playback.toggleLoop}
      >
        <Repeat />
      </Toggle>
      <Toggle
        aria-label="Mute"
        pressed={playback.isMuted}
        onPressedChange={playback.toggleSound}
      >
        {playback.isMuted ? <VolumeX /> : <Volume2 />}
      </Toggle>
    </Island>
  );
}

/** Reads the clock itself, so only the readout redraws while the video plays. */
function TimeReadout({
  clock,
  durationMs,
}: {
  clock: Clock;
  durationMs: number;
}) {
  const time = useClockValue(clock, (seconds) => formatTime(seconds * 1000));
  return (
    <span className="ml-2 font-mono text-ui text-muted-foreground tabular-nums">
      {time} <span className="text-faint">/ {formatTime(durationMs)}</span>
    </span>
  );
}
