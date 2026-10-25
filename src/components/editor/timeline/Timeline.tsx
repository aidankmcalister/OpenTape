import { Fragment, type ReactNode, type RefObject } from "react";
import { Film, Scissors } from "lucide-react";
import { useClockValue } from "@/hooks/useVideoClock";
import { useReflow } from "@/hooks/useMorph";
import type { Lanes } from "@/hooks/editor/useProject";
import { useTimelineDrag } from "@/hooks/editor/useTimelineDrag";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub, useSkim } from "@/hooks/editor/useScrub";
import {
  GUTTER_PX,
  laneLayout,
  percentAt,
  isUnderChip,
  rulerLabels,
  rulerMarks,
  timeLabel,
  TRACK_INSET_PX,
  TRACKS_TOP_PX,
} from "@/lib/editor/timeline";
import { laneKinds } from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
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
  trackRef,
  trackWidth,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
  heldMs: number | null;
  onSkim: (ms: number | null) => void;
  lanes: Lanes;
  trackRef: RefObject<HTMLDivElement | null>;
  trackWidth: number;
}) {
  const { time, shown } = edits;
  const { lengthMs, at } = time;
  const scrubProps = useScrub(lengthMs, (ms) => onSeek(time.source(ms)));
  const { regions } = edits.project;
  const { lanes, heightPx } = laneLayout(laneKinds(shown), laneState.collapsed);
  const drag = useTimelineDrag(edits);
  const isReflowing = useReflow(
    [
      lengthMs,
      ...lanes.map(({ kind, isCollapsed }) => kind + isCollapsed),
    ].join(),
    drag.stretch?.track === "clip",
  );
  const skim = useSkim(lengthMs, (ms) =>
    onSkim(ms === null ? null : time.source(ms)),
  );
  return (
    <div
      className={cn(
        "relative isolate flex pr-2 pb-2 transition-[height] duration-160 ease-out motion-reduce:transition-none",
        isReflowing && "reflow",
      )}
      style={{ height: TRACKS_TOP_PX + heightPx + TRACK_INSET_PX }}
    >
      <div className="relative shrink-0" style={{ width: GUTTER_PX }}>
        <div className="absolute inset-x-0 top-8 flex h-9 items-center gap-2 px-3 text-label font-medium text-muted-foreground">
          <Film className="size-4 shrink-0" />
          Recording
        </div>
        <div className="absolute inset-x-0" style={{ top: TRACKS_TOP_PX }}>
          <LaneGutters
            lanes={lanes}
            regions={regions}
            clock={clock}
            laneState={laneState}
          />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-lg bg-track-modifiers">
        <div className="absolute inset-x-0 top-0 h-8 bg-track-recording" />
        {lanes.map(({ kind, top }) => (
          <div
            key={kind}
            data-flow
            className="absolute inset-x-0 h-px bg-foreground/6"
            style={{ top: TRACKS_TOP_PX + top }}
          />
        ))}
        <div
          ref={trackRef}
          data-track
          className="absolute inset-x-3 inset-y-0 select-none"
          onPointerDown={(event) => {
            edits.select([]);
            scrubProps.onPointerDown(event);
          }}
        >
          {durationMs > 0 ? (
            <>
              <Ruler
                durationMs={lengthMs}
                width={trackWidth}
                playheadMs={(seconds) => at(heldMs ?? seconds * 1000)}
                clock={clock}
                skimMs={skim.hoverMs}
              />
              <RecordingTrack
                edits={edits}
                durationMs={lengthMs}
                drag={drag.clip}
                skim={skim}
              />
              <LaneTracks
                edits={edits}
                lanes={lanes}
                heightPx={heightPx}
                durationMs={lengthMs}
                trackWidth={trackWidth}
                clock={clock}
                drag={drag}
                solo={laneState.solo}
                onSeek={(ms) => onSeek(time.source(ms))}
              />
              <Playhead
                clock={clock}
                durationMs={lengthMs}
                playheadMs={(seconds) => at(heldMs ?? seconds * 1000)}
                zIndex={regions.length + 2}
              />
              {skim.hoverMs !== null ? (
                <Marker
                  ms={skim.hoverMs}
                  durationMs={lengthMs}
                  zIndex={regions.length + 3}
                  isMuted
                >
                  {edits.isCutting ? (
                    <div className="absolute top-10 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-highlight text-on-hue">
                      <Scissors className="size-3" />
                    </div>
                  ) : null}
                </Marker>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Ruler({
  durationMs,
  width,
  playheadMs,
  clock,
  skimMs,
}: {
  durationMs: number;
  width: number;
  playheadMs: (seconds: number) => number;
  clock: Clock;
  skimMs: number | null;
}) {
  const xOf = (ms: number) => (percentAt(ms, durationMs) / 100) * width;
  const labels = rulerLabels(durationMs, width);
  const atPlayhead = useClockValue(clock, (seconds) =>
    labels
      .filter((label) => isUnderChip(label, xOf(playheadMs(seconds))))
      .map(({ ms }) => ms),
  );
  const shown = labels.filter(
    (label) =>
      !label.isCrowded &&
      !atPlayhead.includes(label.ms) &&
      (skimMs === null || !isUnderChip(label, xOf(skimMs))),
  );
  return rulerMarks(durationMs, width).map(({ ms, isMajor }) => {
    const left = `${percentAt(ms, durationMs)}%`;
    if (!isMajor) {
      return (
        <div
          key={ms}
          data-flow
          className="pointer-events-none absolute top-7 h-1 w-px bg-foreground/15"
          style={{ left }}
        />
      );
    }
    return (
      <Fragment key={ms}>
        <div
          data-flow
          className="pointer-events-none absolute top-2 h-4 w-px bg-foreground/30"
          style={{ left }}
        />
        {shown
          .filter((label) => label.ms === ms)
          .map(({ from, text }) => (
            <span
              key={text}
              data-flow
              className="pointer-events-none absolute top-2 font-mono text-caption leading-4 text-muted-foreground"
              style={{ left: from }}
            >
              {text}
            </span>
          ))}
      </Fragment>
    );
  });
}

function Playhead({
  clock,
  durationMs,
  playheadMs,
  zIndex,
}: {
  clock: Clock;
  durationMs: number;
  playheadMs: (seconds: number) => number;
  zIndex: number;
}) {
  const ms = useClockValue(clock, playheadMs);
  return <Marker ms={ms} durationMs={durationMs} zIndex={zIndex} />;
}

function Marker({
  ms,
  durationMs,
  zIndex,
  isMuted = false,
  children,
}: {
  ms: number;
  durationMs: number;
  zIndex: number;
  isMuted?: boolean;
  children?: ReactNode;
}) {
  const color = isMuted ? "bg-muted-foreground" : "bg-highlight";
  return (
    <div
      data-flow={!isMuted || undefined}
      className={cn(
        "pointer-events-none absolute inset-y-0 -ml-px w-0.5",
        color,
      )}
      style={{ left: `${percentAt(ms, durationMs)}%`, zIndex }}
    >
      <div
        className={cn(
          "absolute top-2 left-1/2 flex h-4 -translate-x-1/2 items-center rounded-sm px-1.5 font-mono text-caption font-semibold text-on-hue",
          color,
        )}
      >
        {timeLabel(ms)}
      </div>
      {children}
    </div>
  );
}
