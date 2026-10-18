import { useRef, type PointerEvent } from "react";
import {
  FastForward,
  Film,
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
  ZoomIn,
} from "lucide-react";
import type { Editor } from "@/features/editor/hooks/useEditor";
import { formatTime } from "@/lib/time";
import {
  REGIONS,
  rulerLabel,
  rulerMarks,
  type Region,
} from "@/features/editor/lib/regions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import AddMenu from "./AddMenu";
import Island from "./Island";

export default function Timeline({ editor }: { editor: Editor }) {
  return (
    <Island className="h-38 shrink-0">
      <Transport editor={editor} />
      <Tracks editor={editor} />
    </Island>
  );
}

/** Tools on the left, play controls in the middle, speed, loop, sound and time on the right. */
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
        <span className="w-16 pl-1 font-mono text-[13px] leading-5 text-muted-foreground tabular-nums">
          {formatTime(playback.currentMs)}
        </span>
      </div>
    </div>
  );
}

/** The ruler, the recording's clip, the zoom and speed regions, and the playhead. Press or drag to seek. */
function Tracks({ editor }: { editor: Editor }) {
  const track = useRef<HTMLDivElement>(null);
  const { playback, regions, selectedId, select } = editor;
  const { durationMs, currentMs } = playback;
  const at = (ms: number) => `${durationMs ? (ms / durationMs) * 100 : 0}%`;

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
        <Ruler durationMs={durationMs} at={at} />
        <div className="absolute inset-x-0 top-6 h-10">
          <Clip durationMs={durationMs} />
        </div>
        <div className="absolute inset-x-0 top-16 h-10">
          {regions.map((region) => (
            <RegionItem
              key={region.id}
              region={region}
              isSelected={region.id === selectedId}
              onSelect={() => select(region.id)}
              style={{
                left: at(region.startMs),
                width: at(region.endMs - region.startMs),
              }}
            />
          ))}
        </div>
        <span
          className="pointer-events-none absolute top-0 -ml-px h-26 w-0.5 bg-highlight"
          style={{ left: at(currentMs) }}
        >
          <span className="absolute top-0 -left-1.25 size-3 rounded-t-[3px] rounded-b-md bg-highlight" />
        </span>
      </div>
    </div>
  );
}

function Ruler({
  durationMs,
  at,
}: {
  durationMs: number;
  at: (ms: number) => string;
}) {
  return (
    <div className="absolute inset-x-0 top-0 h-6">
      {rulerMarks(durationMs).map(({ ms, isMajor }) => (
        <span key={ms} className="absolute top-0 h-6" style={{ left: at(ms) }}>
          {isMajor && (
            <span className="absolute top-0 right-1 text-[11px] leading-4 font-medium text-faint tabular-nums">
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

function Clip({ durationMs }: { durationMs: number }) {
  return (
    <div className="absolute inset-x-0 top-1 flex h-8 items-center gap-2 overflow-hidden rounded-md bg-border px-4">
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-xs bg-highlight" />
      <Film className="size-4 text-muted-foreground" />
      <span className="text-xs font-semibold">Recording</span>
      <Badge variant="mono" className="ml-auto">
        {(durationMs / 1000).toFixed(1)}s
      </Badge>
      <span className="absolute inset-y-0 right-0 w-1 rounded-r-xs bg-highlight" />
    </div>
  );
}

const REGION_STYLES = {
  zoom: {
    Icon: ZoomIn,
    body: "bg-highlight/16 text-highlight-foreground",
    selected: "border-highlight/60",
  },
  speed: {
    Icon: FastForward,
    body: "bg-speed/16 text-speed-foreground",
    selected: "border-speed/60",
  },
};

/** A zoom or speed region. Narrow ones drop the label, then the amount, so they never spill. */
function RegionItem({
  region,
  isSelected,
  onSelect,
  style,
}: {
  region: Region;
  isSelected: boolean;
  onSelect: () => void;
  style: React.CSSProperties;
}) {
  const { Icon, body, selected } = REGION_STYLES[region.kind];
  return (
    <button
      aria-label={`${REGIONS[region.kind].label} ${region.amount}×`}
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
      style={style}
    >
      <Icon className="size-4 shrink-0" />
      <span className="hidden text-xs font-semibold @[110px]:inline">
        {REGIONS[region.kind].label}
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
