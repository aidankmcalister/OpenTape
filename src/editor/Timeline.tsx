import { useRef, type PointerEvent } from "react";
import {
  FastForward,
  Film,
  Gauge,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { useClockValue } from "@/hooks/useVideoClock";
import { formatTime, type Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  REGIONS,
  rulerLabel,
  rulerMarks,
  type Region,
  type RegionKind,
} from "./edits";
import type { Editor } from "./useEditor";

/** How each kind of region looks: in the + menu (`tile`) and on the track. */
const KINDS = {
  zoom: {
    Icon: ZoomIn,
    tile: "bg-highlight/20 text-highlight",
    body: "bg-highlight/16 text-highlight-foreground",
    selected: "border-highlight/60",
  },
  speed: {
    Icon: FastForward,
    tile: "bg-speed/20 text-speed",
    body: "bg-speed/16 text-speed-foreground",
    selected: "border-speed/60",
  },
} satisfies Record<RegionKind, unknown>;

export default function Timeline({ editor }: { editor: Editor }) {
  return (
    <>
      <Transport editor={editor} />
      <Tracks editor={editor} />
    </>
  );
}

function Transport({ editor }: { editor: Editor }) {
  const { playback } = editor;
  return (
    <div className="relative flex h-10 items-center border-b border-hairline px-4">
      <div className="flex items-center gap-1">
        <Button variant="selected" size="icon-xs" aria-label="Select">
          <MousePointer2 />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Cut" disabled>
          <Scissors />
        </Button>
        <Divider />
        <AddMenu onAdd={editor.add} />
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to start"
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
          aria-label="Skip to end"
          onClick={playback.toEnd}
        >
          <SkipForward />
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span className="flex h-6 items-center gap-1.5 px-2 font-mono text-xs text-muted-foreground">
          <Gauge className="size-4" />
          {editor.rate}×
        </span>
        <Divider />
        <Toggle
          size="icon-sm"
          aria-label="Loop"
          pressed={playback.isLooping}
          onPressedChange={playback.toggleLoop}
        >
          <Repeat />
        </Toggle>
        <Toggle
          size="icon-sm"
          aria-label="Sound"
          pressed={!playback.isMuted}
          onPressedChange={playback.toggleMute}
        >
          {playback.isMuted ? <VolumeX /> : <Volume2 />}
        </Toggle>
        <Divider />
        <PlayTime clock={playback.clock} />
      </div>
    </div>
  );
}

/** The + menu: adds a zoom or speed region at the playhead. Z and S do the same. */
function AddMenu({ onAdd }: { onAdd: (kind: RegionKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="icon-xs"
            aria-label="Add at playhead"
          />
        }
      >
        <Plus />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="w-54">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add at playhead</DropdownMenuLabel>
          {(["zoom", "speed"] as const).map((kind) => {
            const { label, hint, key } = REGIONS[kind];
            const { Icon, tile } = KINDS[kind];
            return (
              <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-md",
                    tile,
                  )}
                >
                  <Icon />
                </span>
                <span className="flex-1">
                  <span className="block text-xs leading-4 font-semibold">
                    {label}
                  </span>
                  <span className="block text-caption leading-4 text-muted-foreground">
                    {hint}
                  </span>
                </span>
                <Kbd>{key}</Kbd>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Press or drag anywhere on the tracks to seek. */
function Tracks({ editor }: { editor: Editor }) {
  const track = useRef<HTMLDivElement>(null);
  const { playback, regions, selectedId, select } = editor;
  const { durationMs, clock } = playback;
  const percentOf = (ms: number) =>
    `${durationMs ? (ms / durationMs) * 100 : 0}%`;

  function seekTo(event: PointerEvent) {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds) return;
    playback.seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
  }

  return (
    <div
      className="relative h-28 overflow-hidden"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        select(null);
        seekTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          seekTo(event);
      }}
    >
      <div ref={track} className="absolute inset-y-0 right-4.5 left-8">
        <Ruler durationMs={durationMs} percentOf={percentOf} />
        <div className="absolute inset-x-0 top-6 h-10">
          <div className="absolute inset-x-0 top-1 flex h-8 items-center gap-2 overflow-hidden rounded-md bg-border px-4">
            <span className="absolute inset-y-0 left-0 w-1 rounded-l-xs bg-highlight" />
            <Film className="size-4 text-muted-foreground" />
            <span className="text-xs font-semibold">Recording</span>
            <Badge variant="mono" className="ml-auto">
              {(durationMs / 1000).toFixed(1)}s
            </Badge>
            <span className="absolute inset-y-0 right-0 w-1 rounded-r-xs bg-highlight" />
          </div>
        </div>
        <div className="absolute inset-x-0 top-16 h-10">
          {regions.map((region) => (
            <RegionItem
              key={region.id}
              region={region}
              isSelected={region.id === selectedId}
              onSelect={() => select(region.id)}
              left={percentOf(region.startMs)}
              width={percentOf(region.endMs - region.startMs)}
            />
          ))}
        </div>
        <Playhead clock={clock} percentOf={percentOf} />
      </div>
    </div>
  );
}

/** The playing time. It changes every frame, so it redraws on its own. */
function PlayTime({ clock }: { clock: Clock }) {
  const time = useClockValue(clock, (seconds) => formatTime(seconds * 1000));
  return (
    <span className="w-16 pl-1 font-mono text-ui leading-5 text-muted-foreground tabular-nums">
      {time}
    </span>
  );
}

/** Moves every frame while playing, so it redraws on its own. */
function Playhead({
  clock,
  percentOf,
}: {
  clock: Clock;
  percentOf: (ms: number) => string;
}) {
  const left = useClockValue(clock, (seconds) => percentOf(seconds * 1000));
  return (
    <span
      className="pointer-events-none absolute top-0 -ml-px h-26 w-0.5 bg-highlight"
      style={{ left }}
    >
      <span className="absolute top-0 -left-1.25 size-3 rounded-t-[3px] rounded-b-md bg-highlight" />
    </span>
  );
}

function Ruler({
  durationMs,
  percentOf,
}: {
  durationMs: number;
  percentOf: (ms: number) => string;
}) {
  return (
    <div className="absolute inset-x-0 top-0 h-6">
      {rulerMarks(durationMs).map(({ ms, isMajor }) => (
        <span
          key={ms}
          className="absolute top-0 h-6"
          style={{ left: percentOf(ms) }}
        >
          {isMajor && (
            <span className="absolute top-0 right-1 text-caption leading-4 font-medium text-faint tabular-nums">
              {rulerLabel(ms)}
            </span>
          )}
          <span
            className={cn(
              "absolute bottom-0 w-px",
              isMajor ? "h-2.5 bg-faint" : "h-1.5 bg-faint/45",
            )}
          />
        </span>
      ))}
    </div>
  );
}

/** A zoom or speed region. Narrow ones drop the label, then the amount, so they never spill. */
function RegionItem({
  region,
  isSelected,
  onSelect,
  left,
  width,
}: {
  region: Region;
  isSelected: boolean;
  onSelect: () => void;
  left: string;
  width: string;
}) {
  const { Icon, body, selected } = KINDS[region.kind];
  const { label } = REGIONS[region.kind];
  return (
    <button
      aria-label={`${label} ${region.amount}×`}
      aria-pressed={isSelected}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        "@container absolute top-1 flex h-8 items-center gap-2 overflow-hidden rounded-md border border-transparent px-3",
        body,
        isSelected && selected,
      )}
      style={{ left, width }}
    >
      <Icon className="size-4 shrink-0" />
      <span className="hidden text-xs font-semibold @[110px]:inline">
        {label}
      </span>
      <Badge
        variant={region.kind}
        className="ml-auto hidden @[64px]:inline-flex"
      >
        {region.amount}×
      </Badge>
    </button>
  );
}

function Divider() {
  return (
    <Separator orientation="vertical" className="mx-1 h-4 bg-glass-border" />
  );
}
