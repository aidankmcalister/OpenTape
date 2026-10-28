import {
  Gauge,
  MousePointer2,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Playback, useTimeMap } from "@/hooks/editor/usePlayback";
import type { Edits, Lanes } from "@/hooks/editor/useProject";
import { useClockValue } from "@/hooks/useVideoClock";
import { formatTime, type Clock } from "@/lib/time";
import AddMenu from "./AddMenu";

const SPEEDS = [0.5, 1, 1.5, 2];

export default function Transport({
  playback,
  moves,
  edits,
  lanes,
  hasSound,
  isAddOpen,
  onAddOpenChange,
}: {
  playback: Playback;
  moves: ReturnType<typeof useTimeMap>;
  edits: Edits;
  lanes: Lanes;
  hasSound: boolean;
  isAddOpen: boolean;
  onAddOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <div className="grid h-10.25 grid-cols-3 items-start px-1 pt-1 hairline-b">
      <div className="flex items-center gap-1">
        <Toggle
          size="icon"
          aria-label="Select tool"
          pressed={!edits.isCutting}
          onPressedChange={() => edits.setCutting(false)}
        >
          <MousePointer2 />
        </Toggle>
        <Toggle
          size="icon"
          aria-label="Cut tool"
          pressed={edits.isCutting}
          onPressedChange={edits.setCutting}
        >
          <Scissors />
        </Toggle>
        <Separator orientation="vertical" className="mx-1 my-3" />
        <AddMenu
          isOpen={isAddOpen}
          onOpenChange={onAddOpenChange}
          onAdd={edits.add}
          lanes={lanes}
        />
      </div>
      <div className="flex justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to the start"
          onClick={moves.toStart}
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={playback.isPlaying ? "Pause" : "Play"}
          onClick={moves.togglePlay}
        >
          {playback.isPlaying ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Skip to the end"
          onClick={moves.toEnd}
        >
          <SkipForward />
        </Button>
      </div>
      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                aria-label="Playback speed"
                className="font-mono"
              />
            }
          >
            <Gauge data-icon="inline-start" />
            {playback.speed}×
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-28">
            <DropdownMenuRadioGroup
              value={playback.speed}
              onValueChange={(speed) => playback.setSpeed(Number(speed))}
            >
              {SPEEDS.map((speed) => (
                <DropdownMenuRadioItem
                  key={speed}
                  value={speed}
                  className="font-mono"
                >
                  {speed}×
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Toggle
          size="icon"
          aria-label="Loop"
          pressed={playback.isLooping}
          onPressedChange={playback.toggleLoop}
        >
          <Repeat />
        </Toggle>
        <Tooltip disabled={hasSound}>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Toggle
              size="icon"
              aria-label="Mute"
              pressed={playback.isMuted && hasSound}
              disabled={!hasSound}
              onPressedChange={playback.toggleSound}
            >
              {playback.isMuted ? <VolumeX /> : <Volume2 />}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>This recording has no sound</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mx-2 my-3" />
        <TimeReadout clock={playback.clock} at={edits.time.at} />
      </div>
    </div>
  );
}

function TimeReadout({
  clock,
  at,
}: {
  clock: Clock;
  at: (sourceMs: number) => number;
}) {
  const time = useClockValue(clock, (seconds) =>
    formatTime(at(seconds * 1000)),
  );
  return (
    <span className="mr-2 font-mono text-ui text-muted-foreground tabular-nums">
      {time}
    </span>
  );
}
