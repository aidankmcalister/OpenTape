import { useClockValue } from "@/hooks/useVideoClock";
import { useScrub } from "@/hooks/editor/useScrub";
import { rulerLabel, rulerMarks } from "@/lib/editor/edits";
import { percentAt } from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import Island from "./Island";

/** The strip under the transport: a ruler across the whole recording, with the playhead. Press or drag on it to seek. */
export default function Timeline({
  clock,
  durationMs,
  onSeek,
}: {
  clock: Clock;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const scrubProps = useScrub(durationMs, onSeek);
  return (
    <Island className="h-14 shrink-0 px-4">
      <div className="relative h-full select-none" {...scrubProps}>
        {durationMs > 0 ? (
          <>
            <Ruler durationMs={durationMs} />
            <Playhead clock={clock} durationMs={durationMs} />
          </>
        ) : null}
      </div>
    </Island>
  );
}

/** A mark every half step and a label every step, at a step that fits about ten labels. */
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

/** The line at the current time. It reads the clock itself, so only it moves every frame. */
function Playhead({ clock, durationMs }: { clock: Clock; durationMs: number }) {
  const left = useClockValue(clock, (seconds) =>
    percentAt(seconds * 1000, durationMs),
  );
  return (
    <div
      className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-highlight"
      style={{ left: `${left}%` }}
    />
  );
}
