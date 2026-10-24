import {
  Pause,
  Play,
  Plus,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import type { Playback } from "@/hooks/editor/usePlayback";
import { useClockValue } from "@/hooks/useVideoClock";
import { REGIONS, type RegionKind } from "@/lib/editor/regions";
import { formatTime, type Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { REGION_LOOKS } from "./Timeline";

export default function Transport({
  playback,
  onAdd,
  isCutting,
  onToggleCut,
}: {
  playback: Playback;
  onAdd: (kind: RegionKind) => void;
  isCutting: boolean;
  onToggleCut: () => void;
}) {
  return (
    <div className="grid h-10 grid-cols-3 items-center border-b border-hairline px-2">
      <div className="flex items-center gap-1">
        <Toggle
          aria-label="Cut tool"
          pressed={isCutting}
          onPressedChange={onToggleCut}
        >
          <Scissors />
        </Toggle>
        <Separator orientation="vertical" className="mx-1 my-3" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Add at the playhead"
              />
            }
          >
            <Plus />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2">
                Add at playhead
              </DropdownMenuLabel>
              {(Object.keys(REGIONS) as RegionKind[]).map((kind) => {
                const { Icon, tone } = REGION_LOOKS[kind];
                return (
                  <DropdownMenuItem
                    key={kind}
                    className="h-10 gap-3"
                    onClick={() => onAdd(kind)}
                  >
                    <span
                      className={cn(
                        "grid size-7 place-items-center rounded-md",
                        tone,
                      )}
                    >
                      <Icon />
                    </span>
                    <span className="font-semibold">{REGIONS[kind].label}</span>
                    <Kbd className="ml-auto">{REGIONS[kind].key}</Kbd>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
