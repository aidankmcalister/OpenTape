import { ZoomIn } from "lucide-react";
import { useClockValue } from "@/hooks/useVideoClock";
import { useRegionDrag } from "@/hooks/editor/useRegionDrag";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub } from "@/hooks/editor/useScrub";
import {
  rulerLabel,
  rulerMarks,
  type Region,
  type RegionDrag,
} from "@/lib/editor/edits";
import { percentAt } from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";

export default function Timeline({
  clock,
  durationMs,
  edits,
  onSeek,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
}) {
  const scrubProps = useScrub(durationMs, onSeek);
  const dragProps = useRegionDrag(edits, durationMs);
  return (
    <div className="h-20 px-4">
      <div
        data-track
        className="relative h-full select-none"
        {...scrubProps}
        onPointerDown={(event) => {
          edits.select(null);
          scrubProps.onPointerDown(event);
        }}
      >
        {durationMs > 0 ? (
          <>
            <Ruler durationMs={durationMs} />
            {edits.project.regions.map((region) => (
              <RegionItem
                key={region.id}
                region={region}
                durationMs={durationMs}
                isSelected={region.id === edits.selectedId}
                dragProps={dragProps}
              />
            ))}
            <Playhead clock={clock} durationMs={durationMs} />
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

function RegionItem({
  region,
  durationMs,
  isSelected,
  dragProps,
}: {
  region: Region;
  durationMs: number;
  isSelected: boolean;
  dragProps: ReturnType<typeof useRegionDrag>;
}) {
  return (
    <div
      data-selected={isSelected}
      className="group absolute bottom-2 flex h-8 cursor-grab items-center gap-2 overflow-hidden rounded-sm border border-transparent bg-highlight/16 px-3 text-highlight-foreground active:cursor-grabbing data-[selected=true]:border-highlight"
      style={{
        left: `${percentAt(region.startMs, durationMs)}%`,
        width: `${percentAt(region.endMs - region.startMs, durationMs)}%`,
      }}
      {...dragProps(region.id, "move")}
    >
      <ZoomIn className="size-4 shrink-0" />
      <span className="text-caption font-semibold">Zoom</span>
      <span className="ml-auto rounded-full bg-highlight/30 px-2 font-mono text-caption leading-5">
        {region.amount}×
      </span>
      <Grip edge="start" id={region.id} dragProps={dragProps} />
      <Grip edge="end" id={region.id} dragProps={dragProps} />
    </div>
  );
}

function Grip({
  edge,
  id,
  dragProps,
}: {
  edge: RegionDrag;
  id: number;
  dragProps: ReturnType<typeof useRegionDrag>;
}) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 flex w-2 cursor-ew-resize items-center justify-center",
        edge === "start" ? "left-0" : "right-0",
      )}
      {...dragProps(id, edge)}
    >
      <div className="h-3 w-0.5 rounded-full bg-highlight-foreground opacity-40 group-data-[selected=true]:opacity-80" />
    </div>
  );
}

function Playhead({ clock, durationMs }: { clock: Clock; durationMs: number }) {
  const left = useClockValue(clock, (seconds) =>
    percentAt(seconds * 1000, durationMs),
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
