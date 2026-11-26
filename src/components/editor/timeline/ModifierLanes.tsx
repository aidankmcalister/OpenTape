import {
  Fragment,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Focus,
  Trash2,
  X,
} from "lucide-react";
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
import { useClockValue } from "@/hooks/editor/usePlayback";
import {
  ALL_KINDS,
  blockValue,
  covers,
  KEYCAPS_KIND,
  REGIONS,
  type Region,
  type RegionDrag,
  type RegionKind,
  spanOf,
} from "@/lib/editor/regions";
import { SUGGESTIONS } from "@/lib/editor/cursor";
import {
  badgeCaps,
  keyCounts,
  pressCount,
  type Pressed,
} from "@/lib/editor/keys";
import {
  blockSpan,
  blockTier,
  keyRuns,
  laneNeighbors,
  dragMarks,
  msAtX,
  regionsInBox,
  blockOrder,
  nextBlock,
  RULER_PX,
  runTier,
  selectedRun,
  timeLabel,
  type Lane,
} from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { hueOf, REGION_ICONS, RegionValue, useMeasureText } from "./kinds";

export function LaneGutters({
  lanes,
  laneState,
}: {
  lanes: Lane[];
  laneState: Lanes;
}) {
  return lanes.map((lane) => (
    <LaneGutter key={lane.kind} lane={lane} laneState={laneState} />
  ));
}

/** A lane's name, with Solo and Collapse on hover. */
function LaneGutter({ lane, laneState }: { lane: Lane; laneState: Lanes }) {
  const { kind, isCollapsed } = lane;
  const { label } = REGIONS[kind];
  const Icon = REGION_ICONS[kind];
  return (
    <div
      data-solo={laneState.solo === kind}
      data-flow
      className="group/lane fade-in absolute inset-x-0 flex items-center gap-2 pr-1 pl-3 text-label font-medium text-hue-foreground transition-colors hover:bg-accent/40"
      style={{ top: lane.top, height: lane.height, ...hueOf(kind) }}
    >
      <Icon className="size-4 shrink-0 text-hue-foreground" />
      <span className="whitespace-nowrap">{label}</span>
      <div
        className={cn(
          "ml-auto items-center gap-0.5 group-has-focus-visible/lane:flex group-hover/lane:flex group-data-[solo=true]/lane:flex",
          // A collapsed lane always shows how to expand it.
          isCollapsed ? "flex" : "hidden",
        )}
      >
        <LaneToggle
          label={`Solo: preview only ${label}`}
          pressed={laneState.solo === kind}
          onPressedChange={() => laneState.toggleSolo(kind)}
          isCollapsed={isCollapsed}
        >
          <Focus />
        </LaneToggle>
        <LaneToggle
          label={`${isCollapsed ? "Expand" : "Collapse"} ${label.toLowerCase()}`}
          pressed={false}
          onPressedChange={() => laneState.toggleCollapsed(kind)}
          isCollapsed={isCollapsed}
        >
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        </LaneToggle>
      </div>
    </div>
  );
}

/** Solo and Collapse on a lane header, shown on hover. */
function LaneToggle({
  label,
  pressed,
  onPressedChange,
  isCollapsed,
  children,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: () => void;
  isCollapsed: boolean;
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
            className={cn(
              "rounded-[5px] aria-pressed:bg-hue-fill aria-pressed:text-hue-foreground",
              // Inset from the row's edges: 4 px in a lane, 2 px in a collapsed one.
              isCollapsed
                ? "h-4 w-5 min-w-5 [&_svg:not([class*='size-'])]:size-3"
                : "size-6 min-w-6 [&_svg:not([class*='size-'])]:size-3.5",
            )}
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
  pressed,
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
  pressed: Pressed[];
  onSeek: (ms: number) => void;
}) {
  const { shown: regions, time, selectedIds } = edits;
  const { box, marqueeProps } = useMarquee(
    (box, width, isAdding) =>
      edits.select(
        regionsInBox(
          regions,
          box,
          width,
          timelineMs,
          lanes,
          isAdding ? selectedIds : [],
        ),
      ),
    (x, width) => {
      edits.select([]);
      onSeek(msAtX(x, width, timelineMs));
    },
  );
  const measureText = useMeasureText();
  const order = blockOrder(regions);
  const pxAt = (ms: number) => (ms / timelineMs) * trackWidth;
  // Key presses are in recording time; blocks are in kept time.
  const inKeptTime = (keys: Pressed[]) =>
    time
      .shown(keys.map(({ ms, caps }) => ({ startMs: ms, endMs: ms + 1, caps })))
      .map(({ startMs, caps }) => ({ ms: startMs, caps }));
  const keptPressed = inKeptTime(pressed);
  const keysLane = lanes.find(({ kind }) => kind === KEYCAPS_KIND);
  const runs =
    keysLane && !keysLane.isCollapsed
      ? keyRuns(regions, pxAt, measureText)
      : [];
  const inRun = new Set(runs.flat());
  const selected = regions.filter(({ id }) => selectedIds.includes(id));
  const runSelected = selectedRun(runs, selectedIds);
  const selection = spanOf(selected);
  const focusStop = selectedIds[selectedIds.length - 1] ?? order[0]?.id;
  const isDimmed = (kind: RegionKind) => solo !== null && solo !== kind;

  function onBlockKey(event: KeyboardEvent<HTMLElement>, from: Region[]) {
    if (event.metaKey || event.ctrlKey) return;
    const step = {
      Tab: event.shiftKey ? "previous" : "next",
      ArrowUp: "up",
      ArrowDown: "down",
    }[event.key] as Parameters<typeof nextBlock>[4] | undefined;
    const [region] = from;
    if (step) {
      const target = nextBlock(regions, lanes, runs, from, step);
      if (!target && event.key === "Tab") return;
      event.preventDefault();
      if (!target) return;
      // A run draws as one element, under its first block's id.
      edits.select(target.map(({ id }) => id));
      document
        .querySelector<HTMLElement>(`[data-region-id="${target[0].id}"]`)
        ?.focus();
    } else if (from.length > 1) {
      return;
    } else if (event.key === "Enter" && region.isSuggested) {
      event.preventDefault();
      event.stopPropagation();
      edits.settle(region.id, true);
    } else if (event.key === "Enter" || event.key.toLowerCase() === "e") {
      event.preventDefault();
      event.stopPropagation();
      edits.openEditor(region.id);
    }
  }

  return (
    <div
      className="absolute inset-x-0"
      style={{ top: "var(--lanes-top)", height: heightPx }}
      {...marqueeProps}
    >
      {lanes.length === 0 ? <EmptyLanes /> : null}
      {keysLane &&
      !keysLane.isCollapsed &&
      !regions.some(({ kind }) => kind === KEYCAPS_KIND) ? (
        <div
          className="absolute inset-x-0 flex h-8 items-center justify-center text-label text-muted-foreground"
          style={{ top: keysLane.top }}
        >
          No shortcuts in this recording
        </div>
      ) : null}
      {runs.map((members) => (
        <Run
          key={members[0].id}
          members={members}
          lane={keysLane!}
          regions={regions}
          pxAt={pxAt}
          rank={order.indexOf(members[0])}
          isSelected={members.every(({ id }) => selectedIds.includes(id))}
          hasPill={runSelected === members}
          isFocusStop={members.some(({ id }) => id === focusStop)}
          isDimmed={isDimmed(KEYCAPS_KIND)}
          counts={keyCounts(keptPressed, members)}
          clock={clock}
          at={time.at}
          drag={drag.region}
          onKeyDown={(event) => onBlockKey(event, members)}
        />
      ))}
      {regions.map((region) => {
        const lane = lanes.find(({ kind }) => kind === region.kind);
        if (!lane || inRun.has(region)) return null;
        return (
          <Block
            key={region.id}
            region={region}
            lane={lane}
            regions={regions}
            pxAt={pxAt}
            rank={order.indexOf(region)}
            isSelected={selectedIds.includes(region.id)}
            hasPill={selectedIds.length === 1 && selectedIds[0] === region.id}
            isFocusStop={region.id === focusStop}
            isDimmed={isDimmed(region.kind)}
            count={
              REGIONS[region.kind].showsKeycaps
                ? pressCount(keptPressed, region)
                : 0
            }
            stretchEdge={
              drag.stretch?.track === "region" &&
              drag.stretch.id === region.id &&
              drag.stretch.edge !== "move"
                ? drag.stretch.edge
                : null
            }
            clock={clock}
            at={time.at}
            drag={drag.region}
            onOpen={() => edits.openEditor(region.id)}
            onSettle={(isKept) => edits.settle(region.id, isKept)}
            onKeyDown={(event) => onBlockKey(event, [region])}
          />
        );
      })}
      {drag.stretch?.track === "region" ? (
        <DragMarks
          edits={edits}
          lanes={lanes}
          ids={drag.stretch.ids}
          id={drag.stretch.id}
          edge={drag.stretch.edge}
          heightPx={heightPx}
          pxAt={pxAt}
          zIndex={regions.length + 4}
        />
      ) : selected.length > 1 && !runSelected ? (
        <Hovering
          atPx={pxAt((selection.startMs + selection.endMs) / 2)}
          zIndex={regions.length + 4}
          className="pr-1 font-semibold"
        >
          {selected.length} blocks
          <button
            type="button"
            className="flex h-5 items-center gap-1 rounded-[5px] bg-foreground/10 px-1.5 text-muted-foreground transition-colors hover:text-foreground"
            onClick={edits.remove}
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        </Hovering>
      ) : null}
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
    <div className="absolute inset-x-3 top-1 flex h-14 items-center justify-center rounded-lg text-label text-muted-foreground inset-ring inset-ring-hairline">
      <p>
        Press{" "}
        {ALL_KINDS.map((kind, index) => (
          <Fragment key={kind}>
            {index === 0 ? "" : index === ALL_KINDS.length - 1 ? " or " : ", "}
            <Kbd>{REGIONS[kind].key}</Kbd>
          </Fragment>
        ))}{" "}
        to add a block at the playhead, or <Kbd>/</Kbd> for the menu
      </p>
    </div>
  );
}

/** A label over the ruler, centered at `atPx`: a drag's time or length, or the selection's count. */
function Hovering({
  atPx,
  zIndex,
  className,
  children,
}: {
  atPx: number;
  zIndex: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute flex h-7 -translate-x-1/2 items-center gap-2 rounded-lg border border-glass-border bg-popover pl-2.5 text-label text-popover-foreground shadow-md",
        className,
      )}
      style={{ left: atPx, top: "calc(-1 * var(--lanes-top))", zIndex }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/**
 * While blocks drag: a dashed outline where they started, a guide at the edge they caught,
 * and the new start (or, resizing, the new length) over the ruler.
 */
function DragMarks({
  edits,
  lanes,
  ids,
  id,
  edge,
  heightPx,
  pxAt,
  zIndex,
}: {
  edits: Edits;
  lanes: Lane[];
  ids: number[];
  id: number;
  edge: RegionDrag;
  heightPx: number;
  pxAt: (ms: number) => number;
  zIndex: number;
}) {
  const marks = dragMarks(
    edits.shown,
    edits.time.shown(edits.saved.regions),
    ids,
    id,
    edge,
    edits.snapEdgesMs(),
  );
  if (!marks) return null;
  return (
    <>
      {marks.origins.map((origin) => {
        const lane = lanes.find(({ kind }) => kind === origin.kind);
        if (!lane || lane.isCollapsed) return null;
        return (
          <div
            key={origin.id}
            className="pointer-events-none absolute h-6 rounded-md border border-dashed border-foreground/35"
            style={{
              left: pxAt(origin.startMs),
              width: pxAt(origin.endMs) - pxAt(origin.startMs),
              top: lane.top + 4,
              zIndex,
            }}
          />
        );
      })}
      {marks.guideMs !== undefined ? (
        <div
          className="pointer-events-none absolute w-px bg-foreground"
          style={{
            left: pxAt(marks.guideMs),
            top: `calc(${RULER_PX}px - var(--lanes-top))`,
            height: `calc(var(--lanes-top) - ${RULER_PX - heightPx}px)`,
            zIndex,
          }}
        />
      ) : null}
      <Hovering
        atPx={pxAt(marks.atMs)}
        zIndex={zIndex}
        className="pointer-events-none pr-2.5 font-mono font-medium"
      >
        {marks.label}
      </Hovering>
    </>
  );
}

function Block({
  region,
  lane,
  regions,
  pxAt,
  rank,
  isSelected,
  hasPill,
  isFocusStop,
  isDimmed,
  count,
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
  pxAt: (ms: number) => number;
  rank: number;
  isSelected: boolean;
  hasPill: boolean;
  isFocusStop: boolean;
  isDimmed: boolean;
  /** Presses a keystroke block joins: over 1, its pill says × 3. */
  count: number;
  stretchEdge: "start" | "end" | null;
  clock: Clock;
  at: (sourceMs: number) => number;
  drag: TimelineDrag["region"];
  onOpen: () => void;
  onSettle: (isKept: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const [isPillOpen, setIsPillOpen] = useState(false);
  const measureText = useMeasureText();
  const { kind, isSuggested } = region;
  const Icon = REGION_ICONS[kind];
  const name = isSuggested
    ? (SUGGESTIONS[kind]?.label ?? REGIONS[kind].label)
    : REGIONS[kind].label;
  const value = blockValue(region);
  const caps = REGIONS[kind].showsKeycaps ? badgeCaps(value) : undefined;
  const { beforeMs, afterMs } = laneNeighbors(regions, region);
  const span = blockSpan(
    pxAt(region.startMs),
    pxAt(region.endMs),
    pxAt(beforeMs),
    pxAt(afterMs),
  );
  const tier = lane.isCollapsed
    ? "bar"
    : blockTier(span.widthPx, { name, value, caps }, measureText);
  const isActive = useClockValue(clock, (seconds) =>
    covers(region, at(seconds * 1000)),
  );
  const icon = <Icon className="size-3.5 shrink-0" />;
  const content = {
    full: caps ? (
      <>
        {icon}
        <RegionValue kind={kind} value={value} />
      </>
    ) : (
      <>
        <span className="flex items-center gap-1.5">
          {icon}
          {name}
        </span>
        <span className="font-mono">{value}</span>
      </>
    ),
    compact: caps ? (
      <RegionValue kind={kind} value={value} />
    ) : (
      <>
        {icon}
        <span className="font-mono">{value}</span>
      </>
    ),
    icon,
    bar: null,
  }[tier];
  const isWide = span.widthPx >= 32;
  const grips = !lane.isCollapsed ? (
    <>
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
    </>
  ) : null;
  const block = (
    <div
      data-flow
      data-region-id={region.id}
      data-selected={isSelected}
      data-active={isActive && !isSelected}
      aria-label={`${name} ${value}, ${timeLabel(region.startMs)} to ${timeLabel(region.endMs)}`}
      tabIndex={isFocusStop ? 0 : -1}
      onKeyDown={onKeyDown}
      onDoubleClick={onOpen}
      {...drag(region.id, "move")}
      className={cn(
        "group absolute z-(--z) outline-none hover:z-(--z-hover)",
        "cursor-grab active:cursor-grabbing",
        isDimmed && "opacity-35",
      )}
      style={
        {
          ...hueOf(kind),
          "--z": isSelected ? regions.length + 2 : rank + 1,
          "--z-hover": regions.length + (isSelected ? 2 : 1),
          left: span.hitFrom,
          width: span.hitTo - span.hitFrom,
          top: lane.top,
          height: lane.height,
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "absolute flex items-center overflow-hidden text-label font-semibold whitespace-nowrap text-hue-foreground transition-colors duration-120",
          "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-highlight",
          // A suggestion keeps its dashed edge alone: a ring on top of it reads as a double border.
          !isSuggested &&
            "group-data-[active=true]:inset-ring group-data-[active=true]:inset-ring-hue/90 group-data-[selected=true]:inset-ring-[1.5px] group-data-[selected=true]:inset-ring-hue",
          lane.isCollapsed ? "top-[7px] h-1.5" : "fade-in top-1 h-6",
          isSuggested
            ? "border border-dashed border-hue/90 bg-hue/6 group-data-[active=true]:bg-hue/12 group-data-[selected=true]:border-solid group-data-[selected=true]:bg-hue/12"
            : lane.isCollapsed
              ? "bg-hue/60 group-data-[selected=true]:bg-hue"
              : "bg-hue-fill group-hover:bg-hue-hover group-data-[selected=true]:bg-hue-hover",
          {
            full: caps ? "gap-2 px-2" : "justify-between px-[11px]",
            compact: "justify-center gap-1.5",
            icon: "justify-center",
            bar: "",
          }[tier],
        )}
        style={{
          left: span.markFrom - span.hitFrom,
          width: span.widthPx,
          borderRadius: Math.min(lane.isCollapsed ? 3 : 6, span.widthPx / 2),
        }}
      >
        {content}
        {grips && isWide ? grips : null}
      </div>
      {grips && !isWide ? (
        // Too narrow for grips inside: they sit just outside its two ends.
        <div
          className="absolute top-1 h-6 text-hue-foreground"
          style={{
            left: span.markFrom - span.hitFrom - GRIP_PX,
            width: span.widthPx + 2 * GRIP_PX,
          }}
        >
          {grips}
        </div>
      ) : null}
    </div>
  );
  // Every block keeps the same wrapper, so changing size never rebuilds it and replays its fade.
  const needsPill = tier !== "full" || !!isSuggested || count > 1;
  return (
    <Tooltip
      open={needsPill && (hasPill || isPillOpen)}
      onOpenChange={setIsPillOpen}
    >
      <TooltipTrigger render={block} />
      <TooltipContent
        side="top"
        className={cn(
          "h-7 gap-1.5 rounded-lg pl-2 text-label font-semibold text-hue-foreground",
          isSuggested ? "pr-1" : "pr-2.5",
        )}
        style={hueOf(kind)}
      >
        <Icon className="size-4 shrink-0" />
        {name}
        <RegionValue kind={kind} value={value} />
        {count > 1 ? <Times count={count} /> : null}
        {isSuggested ? (
          <span className="ml-1 flex gap-1">
            <button
              type="button"
              aria-label={`Keep ${name.toLowerCase()}`}
              className="flex size-5 items-center justify-center rounded-[5px] bg-hue/30 text-hue-foreground transition-colors hover:bg-hue/45"
              onClick={() => onSettle(true)}
            >
              <Check className="size-3" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${name.toLowerCase()}`}
              className="flex size-5 items-center justify-center rounded-[5px] bg-foreground/10 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onSettle(false)}
            >
              <X className="size-3" />
            </button>
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** "× 3" after keycaps in a pill. */
function Times({ count }: { count: number }) {
  return <span className="font-medium opacity-90">× {count}</span>;
}

/**
 * Keystroke blocks too narrow for their keys, drawn as one block with a count. Only a view:
 * select, move and delete act on its blocks.
 */
function Run({
  members,
  lane,
  regions,
  pxAt,
  rank,
  isSelected,
  hasPill,
  isFocusStop,
  isDimmed,
  counts,
  clock,
  at,
  drag,
  onKeyDown,
}: {
  members: Region[];
  lane: Lane;
  regions: Region[];
  pxAt: (ms: number) => number;
  rank: number;
  isSelected: boolean;
  /** Open while the run is the whole selection. */
  hasPill: boolean;
  isFocusStop: boolean;
  isDimmed: boolean;
  counts: { text: string; count: number }[];
  clock: Clock;
  at: (sourceMs: number) => number;
  drag: TimelineDrag["region"];
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const [isPillOpen, setIsPillOpen] = useState(false);
  const first = members[0];
  const last = members[members.length - 1];
  const ids = members.map(({ id }) => id);
  const span = blockSpan(
    pxAt(first.startMs),
    pxAt(last.endMs),
    pxAt(laneNeighbors(regions, first).beforeMs),
    pxAt(laneNeighbors(regions, last).afterMs),
  );
  const tier = runTier(span.widthPx);
  const isActive = useClockValue(clock, (seconds) =>
    members.some((member) => covers(member, at(seconds * 1000))),
  );
  const Icon = REGION_ICONS[KEYCAPS_KIND];
  const run = (
    <div
      data-flow
      data-region-id={first.id}
      data-selected={isSelected}
      data-active={isActive && !isSelected}
      aria-label={`${members.length} keystrokes, ${timeLabel(first.startMs)} to ${timeLabel(last.endMs)}`}
      tabIndex={isFocusStop ? 0 : -1}
      onKeyDown={onKeyDown}
      {...drag(first.id, "move", ids)}
      className={cn(
        "group absolute z-(--z) cursor-grab outline-none hover:z-(--z-hover) active:cursor-grabbing",
        isDimmed && "opacity-35",
      )}
      style={
        {
          ...hueOf(KEYCAPS_KIND),
          "--z": isSelected ? regions.length + 2 : rank + 1,
          "--z-hover": regions.length + (isSelected ? 2 : 1),
          left: span.hitFrom,
          width: span.hitTo - span.hitFrom,
          top: lane.top,
          height: lane.height,
        } as CSSProperties
      }
    >
      <div
        className="fade-in absolute top-1 flex h-6 items-center justify-center gap-1.5 overflow-hidden bg-hue-fill text-label font-semibold text-hue-foreground transition-colors duration-120 group-hover:bg-hue-hover group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-highlight group-data-[active=true]:inset-ring group-data-[active=true]:inset-ring-hue/90 group-data-[selected=true]:bg-hue-hover group-data-[selected=true]:inset-ring-[1.5px] group-data-[selected=true]:inset-ring-hue"
        style={{
          left: span.markFrom - span.hitFrom,
          width: span.widthPx,
          borderRadius: Math.min(6, span.widthPx / 2),
        }}
      >
        {tier === "full" ? <Icon className="size-3.5 shrink-0" /> : null}
        {tier === "bar" ? null : (
          <span className="flex h-4 min-w-4.5 items-center justify-center rounded-full bg-hue/35 px-1 text-caption">
            {members.length}
          </span>
        )}
      </div>
    </div>
  );
  return (
    <Tooltip open={hasPill || isPillOpen} onOpenChange={setIsPillOpen}>
      <TooltipTrigger render={run} />
      <TooltipContent
        side="top"
        className="h-7 gap-1.5 rounded-lg pr-2.5 pl-2 text-label font-semibold text-hue-foreground"
        style={hueOf(KEYCAPS_KIND)}
      >
        <Icon className="size-4 shrink-0" />
        Run of {members.length}
        {counts.map(({ text, count }) => (
          <Fragment key={text}>
            <RegionValue kind={KEYCAPS_KIND} value={text} />
            <Times count={count} />
          </Fragment>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

const GRIP_PX = 10;

/** A resize handle at each end: a 2 by 10 bar 4 px in, shown on hover and when selected. */
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
        "absolute inset-y-0 w-2.5 cursor-ew-resize",
        edge === "start" ? "left-0" : "right-0",
      )}
      {...dragProps}
    >
      <div
        className={cn(
          "absolute top-1.75 h-2.5 w-0.5 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-60 group-data-[selected=true]:opacity-60",
          edge === "start" ? "left-1" : "right-1",
          isActive && "opacity-60",
        )}
      />
    </div>
  );
}
