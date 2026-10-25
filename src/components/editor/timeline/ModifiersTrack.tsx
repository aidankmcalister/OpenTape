import { useEffect, useRef, type RefObject } from "react";
import type { Edits } from "@/hooks/editor/useProject";
import { useMarquee } from "@/hooks/editor/useScrub";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import {
  blockContent,
  MODIFIERS_TOP_PX,
  msAtX,
  percentAt,
  regionsInBox,
  type RowBox,
} from "@/lib/editor/timeline";
import {
  blockValue,
  REGIONS,
  type Region,
  type RegionDrag,
} from "@/lib/editor/regions";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { hueOf, REGION_ICONS } from "./kinds";

export default function ModifiersTrack({
  edits,
  durationMs,
  trackWidth,
  rows,
  areaPx,
  windowPx,
  windowRef,
  drag,
  onSeek,
}: {
  edits: Edits;
  durationMs: number;
  trackWidth: number;
  rows: RowBox[];
  areaPx: number;
  windowPx: number;
  windowRef: RefObject<HTMLDivElement | null>;
  drag: TimelineDrag;
  onSeek: (ms: number) => void;
}) {
  const { regions } = edits.project;
  const { box, marqueeProps } = useMarquee(
    (box, width) =>
      edits.select(regionsInBox(regions, box, width, durationMs, rows)),
    (x, width) => {
      edits.select([]);
      onSeek(msAtX(x, width, durationMs));
    },
  );
  useRevealNewBlocks(regions, windowRef);
  return (
    <div
      ref={windowRef}
      className="absolute left-0 -right-3 scroll-bar"
      style={{ top: MODIFIERS_TOP_PX, height: windowPx }}
    >
      <div className="relative" style={{ height: areaPx }} {...marqueeProps}>
        {regions.length === 0 ? (
          <span className="absolute inset-y-0 left-0 flex items-center text-label text-muted-foreground">
            Press Z or S, or click +, to place a modifier at the playhead.
          </span>
        ) : null}
        {regions.map((region) => (
          <Block
            key={region.id}
            region={region}
            box={rows[region.row ?? 0]}
            widthPx={
              (trackWidth * (region.endMs - region.startMs)) / durationMs
            }
            durationMs={durationMs}
            isSelected={edits.selectedIds.includes(region.id)}
            isOnlySelected={
              edits.selectedIds.length === 1 &&
              edits.selectedIds[0] === region.id
            }
            stretchEdge={
              drag.stretch?.track === "region" && drag.stretch.id === region.id
                ? drag.stretch.edge
                : null
            }
            drag={drag.region}
            onOpen={() => {
              edits.pick(region.id, false);
              edits.openEditor(region.id);
            }}
          />
        ))}
        {drag.stretch?.track === "region" ? (
          <div
            className="pointer-events-none absolute rounded-md border border-dashed border-highlight/60"
            style={{
              left: `${percentAt(drag.stretch.from.startMs, durationMs)}%`,
              width: `${percentAt(drag.stretch.from.endMs - drag.stretch.from.startMs, durationMs)}%`,
              ...rows[drag.stretch.from.row ?? 0],
            }}
          />
        ) : null}
        {box ? (
          <div
            className="pointer-events-none absolute rounded-sm border border-highlight/60 bg-highlight/10"
            style={{
              left: Math.min(box.x0, box.x1),
              top: Math.min(box.y0, box.y1),
              width: Math.abs(box.x1 - box.x0),
              height: Math.abs(box.y1 - box.y0),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function useRevealNewBlocks(
  regions: Region[],
  windowRef: RefObject<HTMLDivElement | null>,
) {
  const known = useRef(new Set(regions.map(({ id }) => id)));
  useEffect(() => {
    const added = regions.find(({ id }) => !known.current.has(id));
    known.current = new Set(regions.map(({ id }) => id));
    if (added) reveal(windowRef.current, added.id);
  }, [regions, windowRef]);
}

function reveal(scroller: HTMLElement | null, id: number) {
  scroller
    ?.querySelector(`[data-region-id="${id}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function Block({
  region,
  box,
  widthPx,
  durationMs,
  isSelected,
  isOnlySelected,
  stretchEdge,
  drag,
  onOpen,
}: {
  region: Region;
  box: RowBox;
  widthPx: number;
  durationMs: number;
  isSelected: boolean;
  isOnlySelected: boolean;
  stretchEdge: RegionDrag | null;
  drag: TimelineDrag["region"];
  onOpen: () => void;
}) {
  const Icon = REGION_ICONS[region.kind];
  const { label } = REGIONS[region.kind];
  const shown = blockValue(region);
  const content = blockContent(widthPx, label, shown);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOnlySelected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isOnlySelected]);

  return (
    <Tooltip disabled={content === "full"}>
      <TooltipTrigger
        render={<div ref={ref} />}
        data-region-id={region.id}
        data-selected={isSelected}
        data-content={content}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") onOpen();
        }}
        className={cn(
          "group absolute flex cursor-grab items-center overflow-hidden rounded-md text-label font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
          content === "bar"
            ? "rounded-sm bg-hue/60 hover:bg-hue/80"
            : "bg-hue-fill text-hue-foreground hover:bg-hue-hover",
          "data-[selected=true]:bg-hue data-[selected=true]:text-on-hue",
          content === "full" && "gap-2 px-3",
          content === "compact" && "gap-2 px-4",
          content === "icon" && "justify-center",
        )}
        style={{
          ...hueOf(region.kind),
          left: `${percentAt(region.startMs, durationMs)}%`,
          width: `${percentAt(region.endMs - region.startMs, durationMs)}%`,
          ...box,
        }}
        {...drag(region.id, "move")}
      >
        {content === "bar" ? null : <Icon className="size-4 shrink-0" />}
        {content === "full" ? (
          <span className="min-w-0 truncate">{label}</span>
        ) : null}
        {content === "full" || content === "compact" ? (
          <span
            className={cn(
              "min-w-0 truncate font-mono font-medium",
              content === "full" && "ml-auto",
            )}
          >
            {shown}
          </span>
        ) : null}
        <Grip
          edge="start"
          isActive={stretchEdge === "start"}
          {...drag(region.id, "start")}
        />
        <Grip
          edge="end"
          isActive={stretchEdge === "end"}
          {...drag(region.id, "end")}
        />
      </TooltipTrigger>
      <TooltipContent>
        {label} {shown}
      </TooltipContent>
    </Tooltip>
  );
}

function Grip({
  edge,
  isActive,
  ...dragProps
}: { edge: RegionDrag; isActive: boolean } & ReturnType<
  TimelineDrag["region"]
>) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 flex w-2 cursor-ew-resize items-center justify-center",
        edge === "start" ? "left-0" : "right-0",
      )}
      {...dragProps}
    >
      <div
        className={cn(
          "h-3 w-0.5 rounded-full bg-current opacity-30 group-hover:opacity-100 group-data-[content=bar]:hidden group-data-[selected=true]:opacity-100",
          isActive && "h-4 w-[3px] opacity-100",
        )}
      />
    </div>
  );
}
