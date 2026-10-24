import { FastForward, Film, Layers, Scissors, ZoomIn } from "lucide-react";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  type TimelineDrag,
  useTimelineDrag,
} from "@/hooks/editor/useTimelineDrag";
import type { Edits } from "@/hooks/editor/useProject";
import { useScrub, useSkim } from "@/hooks/editor/useScrub";
import { type Clip, clipSeams, keptClips } from "@/lib/editor/clips";
import { rulerLabel, rulerMarks } from "@/lib/editor/timeline";
import {
  REGIONS,
  type Region,
  type RegionDrag,
  type RegionKind,
} from "@/lib/editor/regions";
import { percentAt } from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";

export const REGION_LOOKS: Record<
  RegionKind,
  { Icon: typeof ZoomIn; tone: string; selected: string; badge: string }
> = {
  zoom: {
    Icon: ZoomIn,
    tone: "bg-highlight/16 text-highlight-foreground",
    selected: "data-[selected=true]:border-highlight",
    badge: "bg-highlight/30",
  },
  speed: {
    Icon: FastForward,
    tone: "bg-speed/16 text-speed-foreground",
    selected: "data-[selected=true]:border-speed",
    badge: "bg-speed/30",
  },
};

export default function Timeline({
  clock,
  durationMs,
  edits,
  onSeek,
  heldMs,
  onSkim,
}: {
  clock: Clock;
  durationMs: number;
  edits: Edits;
  onSeek: (ms: number) => void;
  heldMs: number | null;
  onSkim: (ms: number | null) => void;
}) {
  const scrubProps = useScrub(durationMs, onSeek);
  const { hoverMs, msAt, skimProps } = useSkim(durationMs, onSkim);
  const drag = useTimelineDrag(edits, durationMs);
  const clips = keptClips(edits.project.clips, durationMs);
  return (
    <div className="relative flex h-23 pr-4">
      <div className="flex w-8 shrink-0 flex-col items-center pt-6 text-faint">
        <div className="grid h-10 place-items-center">
          <Film className="size-4" />
        </div>
        <div className="grid h-7 place-items-center">
          <Layers className="size-4" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-16 h-px bg-hairline" />
      <div
        data-track
        className="relative flex-1 select-none"
        {...scrubProps}
        onPointerDown={(event) => {
          edits.select(null);
          scrubProps.onPointerDown(event);
        }}
      >
        {durationMs > 0 ? (
          <>
            <Ruler durationMs={durationMs} />
            <div
              className={cn(
                "absolute inset-x-0 top-6 h-10",
                edits.isCutting && "cursor-crosshair",
              )}
              {...skimProps}
              onPointerDownCapture={(event) => {
                if (!edits.isCutting) return;
                event.stopPropagation();
                edits.split(msAt(event));
              }}
            >
              {clips.map((clip, index) => (
                <ClipItem
                  key={clip.id}
                  clip={clip}
                  durationMs={durationMs}
                  isSelected={clip.id === edits.selectedClipId}
                  onSelect={() => edits.selectClip(clip.id)}
                  trims={[
                    ...(index === 0 ? ["start" as const] : []),
                    ...(index === clips.length - 1 ? ["end" as const] : []),
                  ]}
                  drag={drag.clip}
                />
              ))}
              {clipSeams(clips).map((ms) => (
                <Seam key={ms} ms={ms} durationMs={durationMs} />
              ))}
              {hoverMs !== null ? (
                <SkimLine
                  ms={hoverMs}
                  durationMs={durationMs}
                  isCutting={edits.isCutting}
                />
              ) : null}
            </div>
            {edits.project.regions.map((region) => (
              <RegionItem
                key={region.id}
                region={region}
                durationMs={durationMs}
                isSelected={region.id === edits.selectedId}
                drag={drag.region}
              />
            ))}
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

function ClipItem({
  clip,
  durationMs,
  isSelected,
  onSelect,
  trims,
  drag,
}: {
  clip: Clip;
  durationMs: number;
  isSelected: boolean;
  onSelect: () => void;
  trims: ("start" | "end")[];
  drag: TimelineDrag["clip"];
}) {
  return (
    <div
      data-selected={isSelected}
      className="group absolute top-2 flex h-6 items-center gap-2 overflow-hidden rounded-sm bg-accent px-3 text-muted-foreground data-[selected=true]:inset-ring data-[selected=true]:inset-ring-muted-foreground"
      style={{
        left: `${percentAt(clip.startMs, durationMs)}%`,
        width: `${percentAt(clip.endMs - clip.startMs, durationMs)}%`,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <Film className="size-4 shrink-0" />
      <span className="ml-auto rounded-full bg-accent px-2 font-mono text-caption leading-5">
        {((clip.endMs - clip.startMs) / 1000).toFixed(1)}s
      </span>
      {trims.map((edge) => (
        <div
          key={edge}
          className={cn(
            "absolute inset-y-0 w-1.5 cursor-ew-resize bg-primary",
            edge === "start" ? "left-0" : "right-0",
          )}
          {...drag(clip.id, edge)}
        />
      ))}
    </div>
  );
}

function Seam({ ms, durationMs }: { ms: number; durationMs: number }) {
  return (
    <div
      className="pointer-events-none absolute top-2.5 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-card text-muted-foreground"
      style={{ left: `${percentAt(ms, durationMs)}%` }}
    >
      <Scissors className="size-3" />
    </div>
  );
}

function SkimLine({
  ms,
  durationMs,
  isCutting,
}: {
  ms: number;
  durationMs: number;
  isCutting: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 -ml-px w-0.5",
        isCutting ? "bg-primary" : "bg-foreground/40",
      )}
      style={{ left: `${percentAt(ms, durationMs)}%` }}
    >
      {isCutting ? (
        <div className="absolute top-2.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-primary text-primary-foreground">
          <Scissors className="size-3" />
        </div>
      ) : null}
    </div>
  );
}

function RegionItem({
  region,
  durationMs,
  isSelected,
  drag,
}: {
  region: Region;
  durationMs: number;
  isSelected: boolean;
  drag: TimelineDrag["region"];
}) {
  const { Icon, tone, selected, badge } = REGION_LOOKS[region.kind];

  return (
    <div
      data-selected={isSelected}
      className={cn(
        "group absolute top-16.5 flex h-6 cursor-grab items-center gap-2 overflow-hidden rounded-sm border border-transparent px-3 active:cursor-grabbing",
        tone,
        selected,
      )}
      style={{
        left: `${percentAt(region.startMs, durationMs)}%`,
        width: `${percentAt(region.endMs - region.startMs, durationMs)}%`,
      }}
      {...drag(region.id, "move")}
    >
      <Icon className="size-4 shrink-0" />
      <span className="text-caption font-semibold">
        {REGIONS[region.kind].label}
      </span>
      <span
        className={cn(
          "ml-auto rounded-full px-2 font-mono text-caption leading-5",
          badge,
        )}
      >
        {region.amount}×
      </span>
      <Grip edge="start" {...drag(region.id, "start")} />
      <Grip edge="end" {...drag(region.id, "end")} />
    </div>
  );
}

function Grip({
  edge,
  ...dragProps
}: { edge: RegionDrag } & ReturnType<TimelineDrag["region"]>) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 flex w-2 cursor-ew-resize items-center justify-center",
        edge === "start" ? "left-0" : "right-0",
      )}
      {...dragProps}
    >
      <div className="h-3 w-0.5 rounded-full bg-current opacity-40 group-data-[selected=true]:opacity-80" />
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
