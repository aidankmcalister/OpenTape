import type { PointerEvent } from "react";
import { Film, Scissors } from "lucide-react";
import type { Edits } from "@/hooks/editor/useProject";
import { useSkim } from "@/hooks/editor/useScrub";
import type { TimelineDrag } from "@/hooks/editor/useTimelineDrag";
import { type Clip, clipSeams, keptClips } from "@/lib/editor/clips";
import { lengthLabel, percentAt } from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";

export default function RecordingTrack({
  edits,
  durationMs,
  drag,
  onSkim,
}: {
  edits: Edits;
  durationMs: number;
  drag: TimelineDrag["clip"];
  onSkim: (ms: number | null) => void;
}) {
  const { hoverMs, msAt, skimProps } = useSkim(durationMs, onSkim);
  const clips = keptClips(edits.project.clips, durationMs);
  return (
    <div
      className={cn(
        "absolute inset-x-0 top-6 h-8",
        edits.isCutting && "cursor-crosshair",
      )}
      {...skimProps}
      onPointerDownCapture={(event: PointerEvent<HTMLElement>) => {
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
          drag={drag}
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
      className="group absolute top-1 flex h-6 items-center gap-2 overflow-hidden rounded-md bg-accent px-3 text-label font-semibold text-muted-foreground data-[selected=true]:inset-ring data-[selected=true]:inset-ring-muted-foreground"
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
      <span className="ml-auto font-mono font-medium">
        {lengthLabel(clip.endMs - clip.startMs)}
      </span>
      {trims.map((edge) => (
        <div
          key={edge}
          className={cn(
            "absolute inset-y-0 w-1.5 cursor-ew-resize bg-highlight",
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
      className="pointer-events-none absolute top-1.5 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-card text-muted-foreground"
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
        isCutting ? "bg-highlight" : "bg-foreground/40",
      )}
      style={{ left: `${percentAt(ms, durationMs)}%` }}
    >
      {isCutting ? (
        <div className="absolute top-1.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-highlight text-primary-foreground">
          <Scissors className="size-3" />
        </div>
      ) : null}
    </div>
  );
}
