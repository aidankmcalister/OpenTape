import type { PointerEvent } from "react";
import { Film, Scissors } from "lucide-react";
import type { Edits } from "@/hooks/editor/useProject";
import type { Skim } from "@/hooks/editor/useScrub";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import type { Clip } from "@/lib/editor/clips";
import { lengthLabel, percentAt } from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";

export default function RecordingTrack({
  edits,
  timelineMs,
  drag,
  skim: { msAt },
}: {
  edits: Edits;
  timelineMs: number;
  drag: TimelineDrag["clip"];
  skim: Skim;
}) {
  const { clips } = edits.time;
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-8 h-9",
        edits.isCutting && "cursor-crosshair",
      )}
      onPointerDownCapture={(event: PointerEvent<HTMLElement>) => {
        if (!edits.isCutting) return;
        event.stopPropagation();
        edits.split(edits.time.source(msAt(event)));
      }}
    >
      {clips.map((clip, index) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          timelineMs={timelineMs}
          isSelected={clip.id === edits.selectedClipId}
          onSelect={() => edits.selectClip(clip.id)}
          isFirst={index === 0}
          isLast={index === clips.length - 1}
          drag={drag}
        />
      ))}
      {clips.slice(1).map(({ startMs: ms }) => (
        <Seam key={ms} ms={ms} timelineMs={timelineMs} />
      ))}
    </div>
  );
}

const CUT_GAP_PX = 3;

function ClipItem({
  clip,
  timelineMs,
  isSelected,
  onSelect,
  isFirst,
  isLast,
  drag,
}: {
  clip: Clip;
  timelineMs: number;
  isSelected: boolean;
  onSelect: () => void;
  isFirst: boolean;
  isLast: boolean;
  drag: TimelineDrag["clip"];
}) {
  const startGap = isFirst ? 0 : CUT_GAP_PX;
  const gaps = startGap + (isLast ? 0 : CUT_GAP_PX);
  const trims = [
    ...(isFirst ? ["start" as const] : []),
    ...(isLast ? ["end" as const] : []),
  ];
  return (
    <div
      data-selected={isSelected}
      data-flow
      className="group absolute top-1 flex h-7 items-center gap-2 overflow-hidden rounded-sm bg-raised-hover px-4 text-label font-medium text-foreground/80 inset-ring inset-ring-hairline data-[selected=true]:inset-ring-muted-foreground"
      style={{
        left: `calc(${percentAt(clip.startMs, timelineMs)}% + ${startGap}px)`,
        width: `calc(${percentAt(clip.endMs - clip.startMs, timelineMs)}% - ${gaps}px)`,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <Film className="size-4 shrink-0" />
      <span className="ml-auto font-mono">
        {lengthLabel(clip.endMs - clip.startMs)}
      </span>
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

function Seam({ ms, timelineMs }: { ms: number; timelineMs: number }) {
  return (
    <div
      data-flow
      className="pointer-events-none absolute top-2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-track-recording text-foreground/80 ring-1 ring-glass-border"
      style={{ left: `${percentAt(ms, timelineMs)}%` }}
    >
      <Scissors className="size-3" />
    </div>
  );
}
