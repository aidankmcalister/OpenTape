import { type PointerEvent, useMemo } from "react";
import { AudioLines, Film, Mic, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LoadedTrack } from "@/hooks/editor/usePlayback";
import type { Edits } from "@/hooks/editor/useProject";
import type { SoundTrack } from "@/lib/bindings";
import { type SoundSettings, SOUND_TRACKS, waveform } from "@/lib/editor/sound";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import type { Clip, TimeMap } from "@/lib/editor/clips";
import {
  clipParts,
  AUDIO_LANE_PX,
  lengthLabel,
  percentAt,
  rulerLabel,
  TRACKS_TOP_PX,
} from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";

export default function RecordingTrack({
  edits,
  timelineMs,
  trackWidth,
  drag,
  onScrub,
}: {
  edits: Edits;
  timelineMs: number;
  trackWidth: number;
  drag: TimelineDrag["clip"];
  onScrub: (event: PointerEvent<HTMLElement>) => void;
}) {
  const { clips, cuts } = edits.time;
  return (
    <>
      <div className="absolute inset-x-0 top-7 h-9">
        {clips.map((clip, index) => (
          <ClipItem
            key={clip.id}
            clip={clip}
            timelineMs={timelineMs}
            trackWidth={trackWidth}
            isSelected={clip.id === edits.selectedClipId}
            onSelect={(event) => {
              edits.selectClip(clip.id);
              onScrub(event);
            }}
            isFirst={index === 0}
            isLast={index === clips.length - 1}
            drag={drag}
          />
        ))}
      </div>
      {cuts.map((cut) => (
        <Cut
          key={cut.afterId}
          cut={cut}
          timelineMs={timelineMs}
          drag={drag}
          onRestore={() => edits.restore(cut.afterId)}
        />
      ))}
    </>
  );
}

const CUT_GAP_PX = 1;

function ClipItem({
  clip,
  timelineMs,
  trackWidth,
  isSelected,
  onSelect,
  isFirst,
  isLast,
  drag,
}: {
  clip: Clip;
  timelineMs: number;
  trackWidth: number;
  isSelected: boolean;
  onSelect: (event: PointerEvent<HTMLElement>) => void;
  isFirst: boolean;
  isLast: boolean;
  drag: TimelineDrag["clip"];
}) {
  const startGap = isFirst ? 0 : CUT_GAP_PX;
  const gaps = startGap + (isLast ? 0 : CUT_GAP_PX);
  const lengthMs = clip.endMs - clip.startMs;
  const { hasIcon, hasLength } = clipParts(
    (percentAt(lengthMs, timelineMs) / 100) * trackWidth - gaps,
  );
  const trims = [
    ...(isFirst ? ["start" as const] : []),
    ...(isLast ? ["end" as const] : []),
  ];
  return (
    <div
      data-selected={isSelected}
      data-flow
      className={cn(
        "group absolute top-1 flex h-7 items-center gap-2 overflow-hidden rounded-[3px] bg-raised-hover px-4 text-label font-medium text-foreground/80 inset-ring inset-ring-hairline data-[selected=true]:inset-ring-[1.5px] data-[selected=true]:inset-ring-muted-foreground",
        isFirst && "rounded-l-md",
        isLast && "rounded-r-md",
      )}
      style={{
        left: `calc(${percentAt(clip.startMs, timelineMs)}% + ${startGap}px)`,
        width: `calc(${percentAt(lengthMs, timelineMs)}% - ${gaps}px)`,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
    >
      {hasIcon ? <Film className="size-4 shrink-0" /> : null}
      {hasLength ? (
        <span className="ml-auto font-mono">{rulerLabel(lengthMs)}</span>
      ) : null}
      {trims.map((edge) => (
        <div
          key={edge}
          className={cn(
            "absolute inset-y-0 w-3 cursor-ew-resize",
            edge === "start" ? "left-0" : "right-0",
          )}
          {...drag(clip.id, edge)}
        >
          <div
            className={cn(
              "absolute top-1 h-5 w-1 rounded-full bg-highlight",
              edge === "start" ? "left-1" : "right-1",
            )}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A cut: a scissors disc on the ruler and a faint line down the lanes. Hovering it shows what it
 * removed with Restore, and a handle on each side that trims more or brings footage back.
 */
function Cut({
  cut: { atMs, removedMs, beforeId, afterId },
  timelineMs,
  drag,
  onRestore,
}: {
  cut: TimeMap["cuts"][number];
  timelineMs: number;
  drag: TimelineDrag["clip"];
  onRestore: () => void;
}) {
  const left = `${percentAt(atMs, timelineMs)}%`;
  const handles = [
    { id: beforeId, edge: "end" as const, side: "left-0" },
    { id: afterId, edge: "start" as const, side: "right-0" },
  ];
  return (
    <>
      <div
        data-flow
        className="pointer-events-none absolute top-6 bottom-0 w-px -translate-x-1/2 bg-foreground/10"
        style={{ left }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              data-flow
              className="group/cut absolute top-0 h-16 w-4 -translate-x-1/2"
              style={{ left }}
            />
          }
        >
          <div className="pointer-events-none absolute top-0.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-popover text-foreground ring-1 ring-foreground/30">
            <Scissors className="size-3" />
          </div>
          {handles.map(({ id, edge, side }) => (
            <div
              key={edge}
              className={cn("absolute top-7 h-9 w-2 cursor-ew-resize", side)}
              {...drag(id, edge)}
            >
              <div
                className={cn(
                  "absolute top-1.5 h-6 w-1 rounded-full bg-foreground opacity-0 group-hover/cut:opacity-100",
                  edge === "end" ? "left-px" : "right-px",
                )}
              />
            </div>
          ))}
        </TooltipTrigger>
        <TooltipContent className="h-7 gap-2 pr-1 text-label font-medium">
          <Scissors className="size-3.5" />
          {removedMs > 0
            ? `${lengthLabel(removedMs)} removed`
            : "Nothing removed"}
          <Button
            variant="secondary"
            size="xs"
            className="h-5 rounded-full"
            onClick={onRestore}
          >
            Restore
          </Button>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

const SOUND_ICONS: Record<SoundTrack, typeof Mic> = {
  systemAudio: AudioLines,
  microphone: Mic,
};

/** Each sound track's name, beside its waveform lane. */
export function SoundGutters({ sounds }: { sounds: LoadedTrack[] }) {
  return sounds.map(({ track }, index) => {
    const Icon = SOUND_ICONS[track];
    return (
      <div
        key={track}
        className="absolute inset-x-0 flex items-center gap-2 px-3 text-label font-medium text-muted-foreground"
        style={{
          top: TRACKS_TOP_PX + index * AUDIO_LANE_PX,
          height: AUDIO_LANE_PX,
        }}
      >
        <Icon className="size-4 shrink-0" />
        {SOUND_TRACKS.find((sound) => sound.track === track)?.title}
      </div>
    );
  });
}

/**
 * A waveform lane under the Recording track for each sound track, following its cuts. Bars
 * scale with the track's volume; a muted track is drawn flat and dim.
 */
export function SoundLanes({
  sounds,
  settings,
  timelineMs,
  trackWidth,
  sourceAt,
}: {
  sounds: LoadedTrack[];
  settings: SoundSettings;
  timelineMs: number;
  trackWidth: number;
  sourceAt: (ms: number) => number;
}) {
  const columns = Math.min(4000, Math.max(1, Math.round(trackWidth / 3)));
  return sounds.map(({ track, peaks }, index) => (
    <Waveform
      key={track}
      peaks={peaks}
      columns={columns}
      timelineMs={timelineMs}
      sourceAt={sourceAt}
      top={TRACKS_TOP_PX + index * AUDIO_LANE_PX}
      level={settings[track].isMuted ? 0 : settings[track].volume / 100}
    />
  ));
}

function Waveform({
  peaks,
  columns,
  timelineMs,
  sourceAt,
  top,
  level,
}: {
  peaks: Float32Array;
  columns: number;
  timelineMs: number;
  sourceAt: (ms: number) => number;
  top: number;
  level: number;
}) {
  const heights = useMemo(
    () => waveform(peaks, columns, timelineMs, sourceAt),
    [peaks, columns, timelineMs, sourceAt],
  );
  const bars = heights
    .map((height, column) => {
      const half = Math.max(0.04, height * level * 0.9);
      return `M${column + 0.15} ${1 - half}h0.7v${2 * half}h-0.7z`;
    })
    .join("");
  return (
    <div
      data-flow
      className="pointer-events-none absolute inset-x-0 border-t border-foreground/6"
      style={{ top, height: AUDIO_LANE_PX }}
    >
      <svg
        className={cn(
          "absolute inset-x-0 top-1 h-4 w-full",
          level > 0 ? "text-foreground/35" : "text-foreground/12",
        )}
        viewBox={`0 0 ${columns} 2`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={bars} fill="currentColor" />
      </svg>
    </div>
  );
}
