import { Film } from "lucide-react";
import { useClockValue } from "@/hooks/useVideoClock";
import { useElementSize } from "@/hooks/useElementSize";
import type { Lanes } from "@/hooks/editor/useLanes";
import {
  useTimelineDrag,
  type TimelineDrag,
} from "@/hooks/editor/useTimelineDrag";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub } from "@/hooks/editor/useScrub";
import {
  GUTTER_PX,
  laneLayout,
  lengthLabel,
  percentAt,
  rulerLabel,
  rulerMarks,
  timeLabel,
  TRACKS_TOP_PX,
} from "@/lib/editor/timeline";
import { laneKinds, type RegionKind } from "@/lib/editor/regions";
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
  kinds,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
  heldMs: number | null;
  onSkim: (ms: number | null) => void;
  lanes: Lanes;
  kinds: RegionKind[];
}) {
  const scrubProps = useScrub(durationMs, onSeek);
  const { ref: trackRef, size: track } = useElementSize<HTMLDivElement>();
  const { regions } = edits.project;
  const { lanes, heightPx } = laneLayout(
    laneKinds(regions),
    laneState.collapsed,
  );
  const drag = useTimelineDrag(edits, durationMs);
  const draggedLane = lanes.find(
    ({ kind }) =>
      kind === regions.find(({ id }) => id === drag.stretch?.id)?.kind,
  );
  return (
    <div
      className="relative isolate flex pr-4 transition-[height] duration-160 ease-out motion-reduce:transition-none"
      style={{ height: TRACKS_TOP_PX + heightPx }}
    >
      <div
        className="relative shrink-0 hairline-r"
        style={{ width: GUTTER_PX }}
      >
        <div className="absolute inset-x-0 top-6 flex h-8 items-center gap-2 px-3 text-label font-medium text-muted-foreground">
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
      <div
        ref={trackRef}
        data-track
        className="relative flex-1 select-none"
        {...scrubProps}
        onPointerDown={(event) => {
          edits.select([]);
          scrubProps.onPointerDown(event);
        }}
      >
        <div className="absolute inset-x-0 top-6 h-8 bg-track-recording" />
        <div
          className="absolute inset-x-0 bottom-0 bg-track-modifiers"
          style={{ top: TRACKS_TOP_PX }}
        />
        {durationMs > 0 ? (
          <>
            <Ruler durationMs={durationMs} />
            <RecordingTrack
              edits={edits}
              durationMs={durationMs}
              drag={drag.clip}
              onSkim={onSkim}
            />
            <LaneTracks
              edits={edits}
              lanes={lanes}
              heightPx={heightPx}
              top={TRACKS_TOP_PX}
              kinds={kinds}
              durationMs={durationMs}
              trackWidth={track.width}
              clock={clock}
              drag={drag}
              solo={laneState.solo}
              onSeek={onSeek}
            />
            {drag.stretch ? (
              <DragTip
                stretch={drag.stretch}
                top={
                  draggedLane && drag.stretch.track === "region"
                    ? TRACKS_TOP_PX + draggedLane.top - 26
                    : 0
                }
                durationMs={durationMs}
                zIndex={regions.length + 3}
              />
            ) : null}
            <Playhead
              clock={clock}
              durationMs={durationMs}
              heldMs={heldMs}
              zIndex={regions.length + 2}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Ruler({ durationMs }: { durationMs: number }) {
  return (
    <>
      {rulerMarks(durationMs).map(({ ms, isMajor }) => (
        <div
          key={ms}
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: `${percentAt(ms, durationMs)}%` }}
        >
          <div className={cn("w-px bg-faint", isMajor ? "h-2.5" : "h-1.5")} />
          {isMajor ? (
            <span className="font-mono text-micro text-faint">
              {rulerLabel(ms)}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function DragTip({
  stretch,
  top,
  durationMs,
  zIndex,
}: {
  stretch: NonNullable<TimelineDrag["stretch"]>;
  top: number;
  durationMs: number;
  zIndex: number;
}) {
  const { edge, now, from } = stretch;
  const shiftMs = now.startMs - from.startMs;
  return (
    <div
      className="pointer-events-none absolute flex h-6 -translate-x-1/2 items-center gap-1.5 rounded-md border border-glass-border bg-popover px-2 text-label whitespace-nowrap"
      style={{
        left: `${percentAt(edge === "end" ? now.endMs : now.startMs, durationMs)}%`,
        top: Math.max(0, top),
        zIndex,
      }}
    >
      {edge === "move" ? (
        <>
          <span className="font-mono font-semibold">
            {shiftMs < 0 ? "−" : "+"}
            {lengthLabel(Math.abs(shiftMs))}
          </span>
          <span className="text-muted-foreground">
            starts {timeLabel(now.startMs)}
          </span>
        </>
      ) : (
        <>
          <span className="font-mono font-semibold">
            {lengthLabel(now.endMs - now.startMs)}
          </span>
          <span className="text-muted-foreground">
            ends {timeLabel(now.endMs)}
          </span>
        </>
      )}
    </div>
  );
}

function Playhead({
  clock,
  durationMs,
  heldMs,
  zIndex,
}: {
  clock: Clock;
  durationMs: number;
  heldMs: number | null;
  zIndex: number;
}) {
  const ms = useClockValue(clock, (seconds) => heldMs ?? seconds * 1000);
  return (
    <div
      className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-highlight"
      style={{ left: `${percentAt(ms, durationMs)}%`, zIndex }}
    >
      <div className="absolute top-1 left-1/2 flex h-4 -translate-x-1/2 items-center rounded-sm bg-highlight px-1.5 font-mono text-caption font-semibold text-on-hue">
        {timeLabel(ms)}
      </div>
    </div>
  );
}
