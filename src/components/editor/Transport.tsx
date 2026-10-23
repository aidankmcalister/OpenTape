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

export default function Transport({ playback }: { playback: Playback }) {
  return (
    <div className="grid h-10 grid-cols-3 items-center border-b border-hairline px-2">
      <div />
      <div className="flex justify-center gap-1">
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
      </div>
      <div className="flex items-center justify-end gap-1">
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
        <Separator orientation="vertical" className="mx-2 my-3" />
        <TimeReadout clock={playback.clock} />
      </div>
    </div>
  );
}

function TimeReadout({ clock }: { clock: Clock }) {
  const time = useClockValue(clock, (seconds) => formatTime(seconds * 1000));
  return (
    <span className="mr-2 font-mono text-ui text-muted-foreground tabular-nums">
      {time}
    </span>
  );
}
