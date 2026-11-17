import type { PointerEvent } from "react";
import { Film, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Edits } from "@/hooks/editor/useProject";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import type { Clip, TimeMap } from "@/lib/editor/clips";
import {
  clipParts,
  lengthLabel,
  percentAt,
  rulerLabel,
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
