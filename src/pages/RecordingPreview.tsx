import type { ReactNode } from "react";
import { Check, CircleAlert, Copy, Download, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MorphPill, PillDivider, PillMessage } from "@/components/Pill";
import { useClockValue } from "@/hooks/useVideoClock";
import { formatClock, type Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { loopProgress } from "@/lib/preview/preview";
import { useRecordingPreview } from "@/hooks/preview/useRecordingPreview";

/** The recording, playing on a loop, with its length and a close button. Hover shows the actions. */
export default function RecordingPreview() {
  const preview = useRecordingPreview();
  if (!preview.videoSrc) return null;
  const { durationMs, isHovered, activity, hoveredName } = preview;
  const isDockShown = isHovered || activity !== "idle";

  return (
    <div className="relative h-screen w-screen overflow-hidden rounded-xl border border-glass-border bg-card">
      <video
        src={preview.videoSrc}
        autoPlay
        muted
        loop
        playsInline
        className="size-full object-cover"
        {...preview.videoProps}
      />
      <div className="absolute inset-x-2 top-2 flex items-center justify-between">
        {durationMs === null ? (
          <span />
        ) : (
          <Badge variant="overlay">{formatClock(durationMs)}</Badge>
        )}
        <Button
          variant="overlay"
          size="icon-round"
          aria-label="Close"
          onClick={() => void preview.close()}
        >
          <X />
        </Button>
      </div>
      <LoopProgress clock={preview.clock} durationMs={durationMs} />
      {/* The actions, or what Save or Copy is doing. The clip behind is blurred, so it reads on any recording. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-5 flex justify-center",
          !isDockShown && "pointer-events-none",
        )}
      >
        <MorphPill
          active={activity === "idle" ? "actions" : activity}
          className={cn(
            "backdrop-blur-xl backdrop-saturate-150",
            !isDockShown && "opacity-0",
          )}
          layerClassName="gap-1 p-1"
          layers={{
            actions: (
              <>
                <Action
                  name="save"
                  label="Save"
                  shortcut="⌘S"
                  variant="ghost"
                  hoveredName={hoveredName}
                  onClick={() => void preview.save()}
                >
                  <Download />
                </Action>
                <Action
                  name="copy"
                  label="Copy"
                  shortcut="⌘C"
                  variant="ghost"
                  hoveredName={hoveredName}
                  onClick={() => void preview.copy()}
                >
                  <Copy />
                </Action>
                <PillDivider />
                <Action
                  name="edit"
                  label="Edit"
                  shortcut="E"
                  variant="default"
                  hoveredName={hoveredName}
                  onClick={() => void preview.edit()}
                >
                  <Pencil />
                </Action>
              </>
            ),
            saving: <PillMessage icon={<Spinner />}>Saving…</PillMessage>,
            copying: <PillMessage icon={<Spinner />}>Copying…</PillMessage>,
            copied: (
              <PillMessage icon={<Check className="text-highlight" />}>
                Copied to clipboard
              </PillMessage>
            ),
            saved: (
              <>
                <PillMessage icon={<Check className="text-highlight" />}>
                  Saved
                </PillMessage>
                <Button
                  variant="secondary"
                  size="pill-sm"
                  onClick={() => void preview.showInFinder()}
                >
                  Show in Finder
                </Button>
              </>
            ),
            failed: (
              <PillMessage icon={<CircleAlert className="text-destructive" />}>
                <span className="max-w-64 truncate" title={preview.failure}>
                  {preview.failure}
                </span>
              </PillMessage>
            ),
          }}
        />
      </div>
    </div>
  );
}

/** Follows the clip every frame on its own, so the rest of the preview doesn't redraw with it. */
function LoopProgress({
  clock,
  durationMs,
}: {
  clock: Clock;
  durationMs: number | null;
}) {
  const progress = useClockValue(clock, (seconds) =>
    loopProgress(seconds, durationMs),
  );
  return (
    <div className="absolute inset-x-3 bottom-2 h-1 overflow-hidden rounded-full bg-progress-track">
      <div
        className="h-full bg-progress"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

/** A round icon button with its name and key in a tooltip, opened by Rust's hover. */
function Action({
  name,
  label,
  shortcut,
  variant,
  hoveredName,
  onClick,
  children,
}: {
  name: string;
  label: string;
  shortcut: string;
  variant: "ghost" | "default";
  hoveredName: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip open={hoveredName === name}>
      <TooltipTrigger
        render={
          <Button
            data-hover={name}
            variant={variant}
            size="icon-round"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {label}
        <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
