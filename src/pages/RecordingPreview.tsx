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
import { useClockValue } from "@/hooks/editor/usePlayback";
import { formatClock, type Clock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { loopProgress } from "@/lib/preview/preview";
import { useRecordingPreview } from "@/hooks/preview/useRecordingPreview";
import { useOpenedRecording } from "@/hooks/editor/useProject";
import { Frame } from "@/components/editor/Stage";

export default function RecordingPreview() {
  const recording = useOpenedRecording();
  return recording ? (
    <Preview
      key={recording.videoSrc}
      videoSrc={recording.videoSrc}
      fileSrc={recording.fileSrc}
    />
  ) : null;
}

function Preview({
  videoSrc,
  fileSrc,
}: {
  videoSrc: string;
  fileSrc: (name: string) => string;
}) {
  const preview = useRecordingPreview(videoSrc);
  const { playback, edits, exporting, isHovered, layer, hoveredName } = preview;
  const { state } = exporting;
  const progress = state.stage === "exporting" ? state.progress : 1;
  const reason = state.stage === "failed" ? state.reason : undefined;
  const isDockShown = isHovered || layer !== "actions";

  return (
    <div
      className={cn(
        "relative h-screen w-screen overflow-hidden rounded-xl border border-glass-border bg-card",
        !preview.isShown && "invisible",
      )}
    >
      <Frame
        fileSrc={fileSrc}
        appearance={edits.project.appearance}
        ratio={playback.ratio}
        clock={playback.clock}
        regions={edits.project.regions}
        clips={edits.project.clips}
        rings={preview.rings}
        cursor={preview.cursor}
        durationMs={playback.durationMs}
        margin={0}
        frames={playback.frames}
        videoSize={playback.videoSize}
      />
      <div className="absolute inset-x-2 top-2 flex items-center justify-between">
        {playback.durationMs === 0 ? (
          <span />
        ) : (
          <Badge variant="overlay">{formatClock(playback.durationMs)}</Badge>
        )}
        <Button
          variant="overlay"
          size="icon-round"
          aria-label="Close"
          onClick={preview.close}
        >
          <X />
        </Button>
      </div>
      <LoopProgress clock={playback.clock} durationMs={playback.durationMs} />
      <div
        className={cn(
          "absolute inset-x-0 bottom-5 flex justify-center max-[240px]:[&_*]:text-caption",
          !isDockShown && "pointer-events-none",
        )}
      >
        <MorphPill
          active={layer}
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
                  onClick={preview.save}
                >
                  <Download />
                </Action>
                <Action
                  name="copy"
                  label="Copy"
                  shortcut="⌘C"
                  variant="ghost"
                  hoveredName={hoveredName}
                  onClick={preview.copy}
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
                  onClick={preview.edit}
                >
                  <Pencil />
                </Action>
              </>
            ),
            saving: <Progress label="Saving…" progress={progress} />,
            copying: <Progress label="Copying…" progress={progress} />,
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
                  onClick={exporting.showInFinder}
                >
                  Show in Finder
                </Button>
              </>
            ),
            failed: (
              <PillMessage icon={<CircleAlert className="text-destructive" />}>
                <span
                  className="max-w-[min(16rem,calc(100vw-5rem))] truncate"
                  title={reason}
                >
                  {reason}
                </span>
              </PillMessage>
            ),
          }}
        />
      </div>
    </div>
  );
}

function Progress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="flex w-41.5 items-center justify-between pr-3">
      <PillMessage icon={<Spinner />}>{label}</PillMessage>
      <span className="text-ui font-medium tabular-nums">
        {Math.round(progress * 100)}%
      </span>
    </div>
  );
}

function LoopProgress({
  clock,
  durationMs,
}: {
  clock: Clock;
  durationMs: number;
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
