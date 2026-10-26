import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Eye, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Lanes } from "@/hooks/editor/useProject";
import type { Edits } from "@/hooks/editor/useProject";
import { useMarquee } from "@/hooks/editor/useScrub";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  KINDS,
  blockValue,
  covers,
  coveredStretches,
  REGIONS,
  SUGGESTIONS,
  touchingSides,
  winnerAt,
  type Region,
  type RegionDrag,
  type RegionKind,
} from "@/lib/editor/regions";
import {
  blockContent,
  suggestionContent,
  msAtX,
  percentAt,
  regionsInBox,
  blockOrder,
  nextBlock,
  timeLabel,
  TRACKS_TOP_PX,
  type Lane,
} from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { hueOf, REGION_ICONS } from "./kinds";
import { Named } from "../Panel";

export function LaneGutters({
  lanes,
  regions,
  clock,
  laneState,
}: {
  lanes: Lane[];
  regions: Region[];
  clock: Clock;
  laneState: Lanes;
}) {
  return lanes.map((lane) => (
    <LaneGutter
      key={lane.kind}
      lane={lane}
      regions={regions}
      clock={clock}
      laneState={laneState}
    />
  ));
}

function LaneGutter({
  lane,
  regions,
  clock,
  laneState,
}: {
  lane: Lane;
  regions: Region[];
  clock: Clock;
  laneState: Lanes;
}) {
  const { kind, isCollapsed } = lane;
  const { label } = REGIONS[kind];
  const Icon = isCollapsed ? ChevronRight : REGION_ICONS[kind];
  const valueAtPlayhead = useClockValue(clock, (seconds) => {
    const winner = winnerAt(regions, kind, seconds * 1000);
    return winner ? blockValue(winner) : "";
  });
  const count = regions.filter((region) => region.kind === kind).length;
  return (
    <div
      data-solo={laneState.solo === kind}
      data-flow
      className="group/lane fade-in absolute inset-x-0 flex items-center gap-2 px-3 text-label font-medium text-hue-foreground transition-colors hover:bg-accent/40"
      style={{ top: lane.top, height: lane.height, ...hueOf(kind) }}
    >
      <Icon className="size-4 shrink-0 text-hue-foreground" />
      <span className="truncate">{label}</span>
      <span className="ml-auto truncate font-mono text-hue-foreground group-focus-within/lane:hidden group-hover/lane:hidden group-data-[solo=true]/lane:hidden">
        {isCollapsed ? count : valueAtPlayhead}
      </span>
      <div className="ml-auto hidden items-center gap-0.5 group-focus-within/lane:flex group-hover/lane:flex group-data-[solo=true]/lane:flex">
        <LaneToggle
          label={`Solo ${label.toLowerCase()}`}
          pressed={laneState.solo === kind}
          onPressedChange={() => laneState.toggleSolo(kind)}
        >
          <Eye />
        </LaneToggle>
        <LaneToggle
          label={`${isCollapsed ? "Expand" : "Collapse"} ${label.toLowerCase()}`}
          pressed={false}
          onPressedChange={() => laneState.toggleCollapsed(kind)}
        >
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        </LaneToggle>
      </div>
    </div>
  );
}

function LaneToggle({
  label,
  pressed,
  onPressedChange,
  children,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="icon-sm"
            aria-label={label}
            pressed={pressed}
            onPressedChange={onPressedChange}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function LaneTracks({
  edits,
  lanes,
  heightPx,
  timelineMs,
  trackWidth,
  clock,
  drag,
  solo,
  onSeek,
}: {
  edits: Edits;
  lanes: Lane[];
  heightPx: number;
  timelineMs: number;
  trackWidth: number;
  clock: Clock;
  drag: TimelineDrag;
  solo: RegionKind | null;
  onSeek: (ms: number) => void;
}) {
  const { shown: regions, time } = edits;
  const { box, marqueeProps } = useMarquee(
    (box, width) =>
      edits.select(regionsInBox(regions, box, width, timelineMs, lanes)),
    (x, width) => {
      edits.select([]);
      onSeek(msAtX(x, width, timelineMs));
    },
  );
  const order = blockOrder(regions);
  const focusStop =
    [...edits.selectedIds]
      .reverse()
      .find((id) => regions.some(({ id: at }) => at === id)) ?? order[0]?.id;
  const open = (id: number) => {
    edits.openEditor(id);
  };
  const focusBlock = (id: number) => {
    edits.select([id]);
    document.querySelector<HTMLElement>(`[data-region-id="${id}"]`)?.focus();
  };

  function onBlockKey(event: KeyboardEvent<HTMLElement>, region: Region) {
    if (event.metaKey || event.ctrlKey) return;
    const step = {
      Tab: event.shiftKey ? "previous" : "next",
      ArrowUp: "up",
      ArrowDown: "down",
    }[event.key] as Parameters<typeof nextBlock>[3] | undefined;
    if (step) {
      const target = nextBlock(regions, lanes, region, step);
      if (!target && event.key === "Tab") return;
      event.preventDefault();
      if (target) focusBlock(target.id);
    } else if (event.key === "Enter" || event.key.toLowerCase() === "e") {
      event.preventDefault();
      event.stopPropagation();
      open(region.id);
    }
  }

  return (
    <div
      className="absolute inset-x-0"
      style={{ top: TRACKS_TOP_PX, height: heightPx }}
      {...marqueeProps}
    >
      {lanes.length === 0 ? <EmptyLanes /> : null}
      {regions.map((region) => {
        const lane = lanes.find(({ kind }) => kind === region.kind);
        if (!lane) return null;
        return (
          <Block
            key={region.id}
            region={region}
            lane={lane}
            regions={regions}
            timelineMs={timelineMs}
            trackWidth={trackWidth}
            rank={order.indexOf(region)}
            isSelected={edits.selectedIds.includes(region.id)}
            isFocusStop={region.id === focusStop}
            touches={touchingSides(regions, region)}
            isDimmed={solo !== null && solo !== region.kind}
            stretchEdge={
              drag.stretch?.track === "region" && drag.stretch.id === region.id
                ? drag.stretch.edge
                : null
            }
            clock={clock}
            at={time.at}
            drag={drag.region}
            onOpen={() => open(region.id)}
            onSettle={(isKept) => edits.settle(region.id, isKept)}
            onKeyDown={(event) => onBlockKey(event, region)}
          />
        );
      })}
      {box ? (
        <div
          className="pointer-events-none absolute rounded-sm border border-highlight/60 bg-highlight/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
            zIndex: regions.length + 2,
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyLanes() {
  return (
    <div className="absolute inset-x-3 top-1 flex h-14 items-center justify-center gap-1.5 rounded-lg text-label text-muted-foreground inset-ring inset-ring-hairline">
      No modifiers yet. Press
      {KINDS.map((kind) => (
        <Kbd key={kind}>{REGIONS[kind].key}</Kbd>
      ))}
      or + to place one at the playhead.
    </div>
  );
}

function Block({
  region,
  lane,
  regions,
  timelineMs,
  trackWidth,
  rank,
  isSelected,
  isFocusStop,
  touches,
  isDimmed,
  stretchEdge,
  clock,
  at,
  drag,
  onOpen,
  onSettle,
  onKeyDown,
}: {
  region: Region;
  lane: Lane;
  regions: Region[];
  timelineMs: number;
  trackWidth: number;
  rank: number;
  isSelected: boolean;
  isFocusStop: boolean;
  touches: { start: boolean; end: boolean };
  isDimmed: boolean;
  stretchEdge: RegionDrag | null;
  clock: Clock;
  at: (sourceMs: number) => number;
  drag: TimelineDrag["region"];
  onOpen: () => void;
  onSettle: (isKept: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const [isPillOpen, setIsPillOpen] = useState(false);
  const Icon = REGION_ICONS[region.kind];
  const suggestion = region.isSuggested ? SUGGESTIONS[region.kind] : undefined;
  const label = suggestion?.label ?? REGIONS[region.kind].label;
  const value = suggestion ? "" : blockValue(region);
  const lengthMs = region.endMs - region.startMs;
  const gapsPx = Number(touches.start) + Number(touches.end);
  const widthPx = (trackWidth * lengthMs) / timelineMs - gapsPx;
  const content = blockContent(widthPx, label, value);
  const isActive = useClockValue(clock, (seconds) =>
    covers(region, at(seconds * 1000)),
  );
  const span = `${timeLabel(region.startMs)} to ${timeLabel(region.endMs)}`;
  const place = {
    ...hueOf(region.kind),
    left: `calc(${percentAt(region.startMs, timelineMs)}% + ${touches.start ? 1 : 0}px)`,
    width: `calc(${percentAt(lengthMs, timelineMs)}% - ${gapsPx}px)`,
    zIndex: isSelected ? regions.length + 1 : rank + 1,
  };
  const shared = {
    "data-flow": true,
    "data-region-id": region.id,
    "data-selected": isSelected,
    "aria-label": `${label} ${value}, ${span}`,
    onDoubleClick: onOpen,
    ...drag(region.id, "move"),
  };

  if (suggestion && !lane.isCollapsed) {
    const fit = suggestionContent(widthPx, label);
    const choice = (
      <span
        className="flex shrink-0 gap-1"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={`Keep ${label.toLowerCase()}`}
          className="flex size-4 items-center justify-center rounded-sm bg-hue/25 text-hue-foreground transition-colors hover:bg-hue hover:text-on-hue"
          onClick={() => onSettle(true)}
        >
          <Check className="size-3" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          className="flex size-4 items-center justify-center rounded-sm bg-foreground/10 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onSettle(false)}
        >
          <X className="size-3" />
        </button>
      </span>
    );
    const block = (
      <div
        {...shared}
        tabIndex={isFocusStop ? 0 : -1}
        onKeyDown={onKeyDown}
        className={cn(
          "group wipe-in absolute flex cursor-grab items-center gap-1.5 overflow-hidden rounded-md border border-dashed border-hue/70 bg-hue-fill/15 pr-1 pl-2.5 text-label font-semibold whitespace-nowrap text-hue-foreground outline-none active:cursor-grabbing data-[selected=true]:border-solid",
          "focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          fit === "icon" && "justify-center px-0",
          isDimmed && "opacity-35",
        )}
        style={{ ...place, top: lane.top + 4, height: 24 }}
      >
        <Icon className="size-4 shrink-0" />
        {fit === "full" ? (
          <span className="min-w-0 truncate">{label}</span>
        ) : null}
        {fit === "icon" ? null : <span className="ml-auto">{choice}</span>}
      </div>
    );
    if (fit !== "icon")
      return <Named name={suggestion.question}>{block}</Named>;
    return (
      <Tooltip open={isSelected || isPillOpen} onOpenChange={setIsPillOpen}>
        <TooltipTrigger render={block} />
        <TooltipContent side="bottom" className="h-auto p-1">
          {choice}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (lane.isCollapsed) {
    return (
      <div
        {...shared}
        className={cn(
          "group absolute flex cursor-grab items-center",
          isDimmed && "opacity-35",
        )}
        style={{ ...place, top: lane.top, height: lane.height }}
      >
        <div className="h-1.5 w-full rounded-xs bg-hue/70 group-data-[selected=true]:bg-hue" />
      </div>
    );
  }

  return (
    <div
      {...shared}
      data-active={isActive && !isSelected}
      tabIndex={isFocusStop ? 0 : -1}
      onKeyDown={onKeyDown}
      className={cn(
        "group wipe-in absolute flex cursor-grab items-center gap-1.5 overflow-hidden rounded-md bg-hue-fill px-2.5 text-label font-semibold whitespace-nowrap text-hue-foreground transition-colors duration-120 outline-none hover:bg-hue-hover active:cursor-grabbing",
        "data-[active=true]:inset-ring data-[active=true]:inset-ring-hue/85 data-[selected=true]:bg-hue data-[selected=true]:text-on-hue",
        "focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        content === "icon" && "justify-center px-0",
        touches.start && "rounded-l-none",
        touches.end && "rounded-r-none",
        isDimmed && "opacity-35",
      )}
      style={{ ...place, top: lane.top + 4, height: 24 }}
    >
      {coveredStretches(regions, region).map(({ startMs, endMs }) => (
        <span
          key={startMs}
          className="pointer-events-none absolute inset-y-0 covered-stripes"
          style={{
            left: `${((startMs - region.startMs) / lengthMs) * 100}%`,
            width: `${((endMs - startMs) / lengthMs) * 100}%`,
          }}
        />
      ))}
      <Icon className="relative size-4 shrink-0" />
      {content === "full" ? (
        <span className="relative min-w-0 truncate">{label}</span>
      ) : null}
      {content === "icon" ? null : (
        <span
          className={cn(
            "relative min-w-0 truncate font-mono font-medium",
            content === "full" && "ml-auto",
          )}
        >
          {value}
        </span>
      )}
      <Grip
        edge="start"
        isShown={content !== "icon"}
        isActive={stretchEdge === "start"}
        {...drag(region.id, "start")}
      />
      <Grip
        edge="end"
        isShown={content !== "icon"}
        isActive={stretchEdge === "end"}
        {...drag(region.id, "end")}
      />
    </div>
  );
}

function Grip({
  edge,
  isShown,
  isActive,
  ...dragProps
}: { edge: RegionDrag; isShown: boolean; isActive: boolean } & ReturnType<
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
      {isShown ? (
        <div
          className={cn(
            "h-3 w-0.75 rounded-full bg-current opacity-30 group-hover:opacity-100 group-data-[selected=true]:opacity-100",
            isActive && "opacity-100",
          )}
        />
      ) : null}
    </div>
  );
}
