import { useRef } from "react";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  useTimelineDrag,
  type TimelineDrag,
} from "@/hooks/editor/useTimelineDrag";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub } from "@/hooks/editor/useScrub";
import { useElementSize } from "@/hooks/useElementSize";
import {
  lengthLabel,
  MODIFIERS_TOP_PX,
  percentAt,
  rowAtY,
  rowLayout,
  rulerLabel,
  rulerMarks,
  TIMELINE_LIMIT_PX,
  timeLabel,
} from "@/lib/editor/timeline";
import { rowCount } from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import ModifiersTrack from "./ModifiersTrack";
import RecordingTrack from "./RecordingTrack";

const EDGE_SCROLL_PX = 16;
const ROW_SCROLL_PX = 8;

export default function Timeline({
  clock,
  durationMs,
  edits,
  onSeek,
  heldMs,
  onSkim,
  limitPx,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
  heldMs: number | null;
  onSkim: (ms: number | null) => void;
  limitPx: number;
}) {
  const scrubProps = useScrub(durationMs, onSeek);
  const { ref: trackRef, size: track } = useElementSize<HTMLDivElement>();
  const windowRef = useRef<HTMLDivElement>(null);
  const rows = rowCount(edits.project.regions);
  const layout = rowLayout(rows);
  const windowPx = limitPx - TIMELINE_LIMIT_PX.chromePx;
  const rowAt = (clientY: number) => {
    const scroller = windowRef.current;
    if (!scroller) return 0;
    const { top, bottom } = scroller.getBoundingClientRect();
    if (clientY < top + EDGE_SCROLL_PX) scroller.scrollTop -= ROW_SCROLL_PX;
    if (clientY > bottom - EDGE_SCROLL_PX) scroller.scrollTop += ROW_SCROLL_PX;
    return rowAtY(layout.rows, clientY - top + scroller.scrollTop);
  };
  const drag = useTimelineDrag(edits, durationMs, rowAt);
  return (
    <div
      className="relative flex pr-4"
      style={{ height: MODIFIERS_TOP_PX + 4 + windowPx }}
    >
      <div className="absolute inset-x-0 top-6 h-8 bg-track-recording" />
      <div className="absolute inset-x-0 top-14 bottom-0 bg-track-modifiers" />
      <div className="relative w-20 shrink-0 text-label font-medium text-muted-foreground">
        <span className="absolute top-7 left-3 leading-6">Recording</span>
        <span className="absolute top-15 left-3 leading-6">Modifiers</span>
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
        {durationMs > 0 ? (
          <>
            <Ruler durationMs={durationMs} />
            <RecordingTrack
              edits={edits}
              durationMs={durationMs}
              drag={drag.clip}
              onSkim={onSkim}
            />
            <ModifiersTrack
              edits={edits}
              durationMs={durationMs}
              trackWidth={track.width}
              rows={layout.rows}
              areaPx={layout.areaPx}
              windowPx={windowPx}
              windowRef={windowRef}
              drag={drag}
              onSeek={onSeek}
            />
            {drag.stretch ? (
              <StretchTip
                stretch={drag.stretch}
                top={drag.stretch.track === "clip" ? 0 : MODIFIERS_TOP_PX - 28}
                durationMs={durationMs}
              />
            ) : null}
            <Playhead clock={clock} durationMs={durationMs} heldMs={heldMs} />
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

function StretchTip({
  stretch,
  top,
  durationMs,
}: {
  stretch: NonNullable<TimelineDrag["stretch"]>;
  top: number;
  durationMs: number;
}) {
  const { edge, now } = stretch;
  return (
    <div
      className="pointer-events-none absolute z-10 flex h-6 -translate-x-1/2 items-center gap-1.5 rounded-md border border-glass-border bg-popover px-2 text-label whitespace-nowrap"
      style={{
        left: `${percentAt(edge === "start" ? now.startMs : now.endMs, durationMs)}%`,
        top: Math.max(0, top),
      }}
    >
      <span className="font-mono font-semibold">
        {lengthLabel(now.endMs - now.startMs)}
      </span>
      <span className="text-muted-foreground">ends {timeLabel(now.endMs)}</span>
    </div>
  );
}

function Playhead({
  clock,
  durationMs,
  heldMs,
}: {
  clock: Clock;
  durationMs: number;
  heldMs: number | null;
}) {
  const left = useClockValue(clock, (seconds) =>
    percentAt(heldMs ?? seconds * 1000, durationMs),
  );
  return (
    <div
      className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-highlight"
      style={{ left: `${left}%` }}
    >
      <div className="absolute top-0 -left-1 size-2.5 rounded-full bg-highlight" />
    </div>
  );
}
