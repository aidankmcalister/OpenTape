import { type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Film, Minus, Plus, Scissors } from "lucide-react";
import { useClockValue } from "@/hooks/editor/usePlayback";
import { useReflow } from "@/hooks/useMorph";
import type { Lanes } from "@/hooks/editor/useProject";
import { useTimelineDrag } from "@/hooks/editor/useTimelineDrag";
import { type TimelineZoom, useOverview } from "@/hooks/editor/useTimelineZoom";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub, useSkim } from "@/hooks/editor/useScrub";
import {
  GUTTER_PX,
  laneLayout,
  percentAt,
  chipShift,
  isSkimChipShown,
  rulerLabel,
  rulerLabels,
  rulerMarks,
  timeLabel,
  TRACK_INSET_PX,
  RULER_PX,
  TRACKS_TOP_PX,
  type Lane,
} from "@/lib/editor/timeline";
import type { Pressed } from "@/lib/editor/keys";
import type { Region } from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { hueOf } from "./kinds";
import { LaneGutters, LaneTracks } from "./ModifierLanes";
import RecordingTrack from "./RecordingTrack";

export default function Timeline({
  clock,
  durationMs,
  edits,
  onSeek,
  heldMs,
  onSkim,
  lanes: laneState,
  pressed,
  skipped,
  trackRef,
  trackWidth,
  viewportRef,
  zoom,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
  heldMs: number | null;
  onSkim: (ms: number | null) => void;
  lanes: Lanes;
  pressed: Pressed[];
  skipped: Pressed[];
  trackRef: RefObject<HTMLDivElement | null>;
  trackWidth: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  zoom: TimelineZoom;
}) {
  const { time, shown } = edits;
  const { at } = time;
  const drag = useTimelineDrag(edits);
  const lengthMs = Math.max(drag.stretch?.lengthMs ?? 0, time.lengthMs);
  const trimmedMs =
    drag.stretch?.track === "clip" && drag.stretch.edge === "start"
      ? lengthMs - time.lengthMs
      : 0;
  const scrubProps = useScrub(lengthMs, (ms) => onSeek(time.source(ms)));
  const { regions } = edits.project;
  const { lanes, heightPx } = laneLayout(
    laneState.kinds,
    laneState.collapsed,
    laneState.showsSkipped && skipped.length > 0,
  );
  const isReflowing = useReflow(
    [
      lengthMs,
      ...lanes.map(
        ({ kind, isCollapsed, skippedTop }) => kind + isCollapsed + skippedTop,
      ),
    ].join(),
    drag.stretch !== null,
  );
  const skim = useSkim(lengthMs, (ms) =>
    onSkim(ms === null ? null : time.source(Math.max(0, ms - trimmedMs))),
  );
  const overview = useOverview(viewportRef, zoom.zoom);
  return (
    <div
      className={cn(
        "relative isolate flex flex-col transition-[height] duration-160 ease-out motion-reduce:transition-none",
        isReflowing && "reflow",
      )}
      style={{
        height: TRACKS_TOP_PX + heightPx + 2 * TRACK_INSET_PX + FOOTER_PX,
      }}
    >
      <div className="flex min-h-0 flex-1 pt-2 pr-2 pb-2">
        <div className="relative shrink-0" style={{ width: GUTTER_PX }}>
          <div className="absolute inset-x-0 top-7 flex h-9 items-center gap-2 px-3 text-label font-medium text-muted-foreground">
            <Film className="size-4 shrink-0" />
            Recording
          </div>
          <div className="absolute inset-x-0" style={{ top: TRACKS_TOP_PX }}>
            <LaneGutters
              lanes={lanes}
              laneState={laneState}
              hasSkipped={skipped.length > 0}
            />
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden rounded-lg bg-track-modifiers">
          <div className="absolute inset-x-0 top-0 h-7 bg-track-recording" />
          {lanes.map(({ kind, top }) => (
            <div
              key={kind}
              data-flow
              className="absolute inset-x-0 h-px bg-foreground/6"
              style={{ top: TRACKS_TOP_PX + top }}
            />
          ))}
          <EdgeFades
            view={overview}
            zoom={zoom.zoom}
            zIndex={regions.length + 4}
          />
          <div
            ref={viewportRef}
            className="absolute inset-x-3 inset-y-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              ref={trackRef}
              data-track
              className={cn(
                "relative h-full select-none",
                edits.isCutting && "cursor-crosshair",
              )}
              style={{ width: `${zoom.zoom * 100}%` }}
              {...skim.skimProps}
              onPointerDownCapture={(event) => {
                if (!edits.isCutting || event.button !== 0) return;
                event.stopPropagation();
                edits.split(time.source(skim.msAt(event)));
              }}
              onPointerDown={(event) => {
                edits.select([]);
                scrubProps.onPointerDown(event);
              }}
            >
              {durationMs > 0 ? (
                <div
                  data-flow
                  className="absolute inset-y-0 w-full"
                  style={{ left: `${percentAt(trimmedMs, lengthMs)}%` }}
                >
                  <Ruler timelineMs={lengthMs} width={trackWidth} />
                  <RecordingTrack
                    edits={edits}
                    timelineMs={lengthMs}
                    trackWidth={trackWidth}
                    drag={drag.clip}
                    onScrub={scrubProps.onPointerDown}
                  />
                  <LaneTracks
                    edits={edits}
                    lanes={lanes}
                    heightPx={heightPx}
                    timelineMs={lengthMs}
                    trackWidth={trackWidth}
                    clock={clock}
                    drag={drag}
                    solo={laneState.solo}
                    pressed={pressed}
                    skipped={skipped}
                    onSeek={(ms) => onSeek(time.source(ms))}
                  />
                  <Playhead
                    clock={clock}
                    timelineMs={lengthMs}
                    widthPx={trackWidth}
                    playheadMs={(seconds) => at(heldMs ?? seconds * 1000)}
                    skimMs={
                      skim.hoverMs === null ? null : skim.hoverMs - trimmedMs
                    }
                    zIndex={regions.length + 2}
                  >
                    {edits.isCutting ? (
                      <div className="absolute top-0.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-highlight text-on-hue">
                        <Scissors className="size-3" />
                      </div>
                    ) : null}
                  </Playhead>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center border-t border-hairline pr-2">
        <div className="flex shrink-0 pr-2 pl-3" style={{ width: GUTTER_PX }}>
          <ZoomControl zoom={zoom} />
        </div>
        <Overview
          view={overview}
          zoom={zoom.zoom}
          lanes={lanes}
          regions={shown}
          cutsMs={time.cuts.map(({ atMs }) => atMs)}
          timelineMs={lengthMs}
          clock={clock}
          playheadMs={(seconds) => at(heldMs ?? seconds * 1000)}
        />
      </div>
    </div>
  );
}

const FOOTER_PX = 40;
const EDGE_FADE_PX = 8;

/**
 * Zoomed in, the view fades out on any side that has more of the timeline past it. Drawn as
 * overlays in the track colors: a CSS mask on the scrolling view broke drawing in WebKit.
 */
function EdgeFades({
  view: { start, size },
  zoom,
  zIndex,
}: {
  view: { start: number; size: number };
  zoom: number;
  zIndex: number;
}) {
  const sides = [
    { side: "left", isShown: zoom > 1 && start > 0.001 },
    { side: "right", isShown: zoom > 1 && start + size < 0.999 },
  ] as const;
  return sides.map(({ side, isShown }) =>
    isShown ? (
      <div
        key={side}
        className="pointer-events-none absolute inset-y-0"
        style={{
          [side]: 12,
          width: EDGE_FADE_PX,
          zIndex,
          background: [
            `linear-gradient(to ${side === "left" ? "right" : "left"}, var(--track-recording), transparent) top / 100% ${RULER_PX}px no-repeat`,
            `linear-gradient(to ${side === "left" ? "right" : "left"}, var(--track-modifiers), transparent)`,
          ].join(", "),
        }}
      />
    ) : null,
  );
}

function ZoomControl({ zoom }: { zoom: TimelineZoom }) {
  return (
    <div className="flex h-6 w-23 items-center justify-between rounded-md bg-track-modifiers px-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label="Zoom the timeline out"
        disabled={zoom.zoom <= 1}
        onClick={zoom.zoomOut}
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="h-5 font-mono text-muted-foreground"
        aria-label="Fit the timeline"
        onClick={zoom.fit}
      >
        {zoom.zoom > 1 ? rulerLabel(zoom.spanMs) : "Fit"}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label="Zoom the timeline in"
        disabled={!zoom.canZoomIn}
        onClick={zoom.zoomIn}
      >
        <Plus />
      </Button>
    </div>
  );
}

/**
 * The whole recording at a glance: a row of marks per lane (suggestions faint), notches at
 * cuts, the playhead, and the part in view, which drags. Clips aren't drawn.
 */
function Overview({
  view,
  zoom,
  lanes,
  regions,
  cutsMs,
  timelineMs,
  clock,
  playheadMs,
}: {
  view: ReturnType<typeof useOverview>;
  zoom: number;
  lanes: Lane[];
  regions: Region[];
  cutsMs: number[];
  timelineMs: number;
  clock: Clock;
  playheadMs: (seconds: number) => number;
}) {
  const at = (ms: number) => `${percentAt(ms, timelineMs)}%`;
  return (
    <div className="relative h-4 flex-1 rounded-sm bg-track-modifiers">
      <div
        className="absolute inset-x-3 inset-y-0 cursor-grab touch-none active:cursor-grabbing"
        {...view.stripProps}
      >
        <div className="pointer-events-none absolute inset-x-0 inset-y-0.5 flex flex-col gap-px">
          {lanes.map(({ kind }) => (
            <div key={kind} className="relative flex-1" style={hueOf(kind)}>
              {regions
                .filter((region) => region.kind === kind)
                .map((region) => (
                  <div
                    key={region.id}
                    className={cn(
                      "absolute inset-y-0 min-w-0.5 rounded-[1px]",
                      region.isSuggested ? "bg-hue/40" : "bg-hue/90",
                    )}
                    style={{
                      left: at(region.startMs),
                      width: at(region.endMs - region.startMs),
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
        {cutsMs.map((ms) => (
          <div
            key={ms}
            className="pointer-events-none absolute inset-y-0 w-px bg-background"
            style={{ left: at(ms) }}
          />
        ))}
        <OverviewPlayhead
          clock={clock}
          playheadMs={playheadMs}
          timelineMs={timelineMs}
        />
        {zoom > 1 ? (
          <div
            className="pointer-events-none absolute inset-y-0 rounded-[3px] inset-ring inset-ring-foreground/50"
            style={{
              left: `${view.start * 100}%`,
              width: `${view.size * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function OverviewPlayhead({
  clock,
  playheadMs,
  timelineMs,
}: {
  clock: Clock;
  playheadMs: (seconds: number) => number;
  timelineMs: number;
}) {
  const ms = useClockValue(clock, playheadMs);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-highlight"
      style={{ left: `${percentAt(ms, timelineMs)}%` }}
    />
  );
}

function Ruler({ timelineMs, width }: { timelineMs: number; width: number }) {
  return rulerMarks(timelineMs, width).map(({ ms, isMajor }) => (
    <div
      key={ms}
      data-flow
      className={cn(
        "pointer-events-none absolute top-[23px] -translate-x-1/2 -translate-y-1/2 rounded-full",
        isMajor ? "size-[3px] bg-foreground/60" : "size-0.5 bg-foreground/30",
      )}
      style={{ left: `${percentAt(ms, timelineMs)}%` }}
    />
  ));
}

/**
 * The playhead, the skim marker and the ruler labels, which make room for their time chips:
 * the skim chip hides near the playhead's, and a label under either chip hides.
 */
function Playhead({
  clock,
  timelineMs,
  widthPx,
  playheadMs,
  skimMs,
  zIndex,
  children,
}: {
  clock: Clock;
  timelineMs: number;
  widthPx: number;
  playheadMs: (seconds: number) => number;
  skimMs: number | null;
  zIndex: number;
  children: ReactNode;
}) {
  const ms = useClockValue(clock, playheadMs);
  const px = (at: number) => (percentAt(at, timelineMs) / 100) * widthPx;
  const hasSkimChip =
    !children &&
    skimMs !== null &&
    isSkimChipShown(px(skimMs), px(ms), widthPx);
  const chipsPx = hasSkimChip ? [px(ms), px(skimMs)] : [px(ms)];
  const labels = rulerLabels(timelineMs, widthPx, chipsPx).filter(
    ({ isCrowded, isUnderChip }) => !isCrowded && !isUnderChip,
  );
  return (
    <>
      {labels.map(({ ms: labelMs, from, text }) => (
        <span
          key={labelMs}
          data-flow
          className="pointer-events-none absolute top-1 font-mono text-caption leading-4 text-muted-foreground"
          style={{ left: from }}
        >
          {text}
        </span>
      ))}
      <Marker
        ms={ms}
        timelineMs={timelineMs}
        widthPx={widthPx}
        zIndex={zIndex}
      />
      {skimMs !== null ? (
        <Marker
          ms={skimMs}
          timelineMs={timelineMs}
          widthPx={widthPx}
          zIndex={zIndex + 1}
          isSkim
          hasChip={hasSkimChip}
        >
          {children}
        </Marker>
      ) : null}
    </>
  );
}

function Marker({
  ms,
  timelineMs,
  widthPx,
  zIndex,
  isSkim = false,
  hasChip = true,
  children,
}: {
  ms: number;
  timelineMs: number;
  widthPx: number;
  zIndex: number;
  isSkim?: boolean;
  hasChip?: boolean;
  children?: ReactNode;
}) {
  const x = (percentAt(ms, timelineMs) / 100) * widthPx;
  return (
    <div
      data-flow={!isSkim || undefined}
      className={cn(
        "pointer-events-none absolute inset-y-0",
        isSkim
          ? "border-l border-dashed border-foreground/45"
          : "-ml-px w-0.5 bg-highlight",
      )}
      style={{ left: `${percentAt(ms, timelineMs)}%`, zIndex }}
    >
      {hasChip ? (
        <div
          className={cn(
            "absolute top-1.5 flex h-4 w-12.5 -translate-x-1/2 items-center justify-center rounded-[4px] font-mono text-caption font-semibold",
            isSkim
              ? "bg-muted text-foreground/80 inset-ring inset-ring-foreground/30"
              : "bg-highlight text-on-hue",
          )}
          style={{ left: `calc(50% + ${chipShift(x, widthPx)}px)` }}
        >
          {timeLabel(ms)}
        </div>
      ) : null}
      {children}
    </div>
  );
}
