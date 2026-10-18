import type { ReactNode } from "react";
import { Check, CircleAlert, Copy, Download, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordingPreview,
  type RecordingPreview as Preview,
} from "@/hooks/useRecordingPreview";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import MorphPill from "./MorphPill";

/**
 * The recording, playing on a loop, with its length and a close button. Hover shows the actions.
 * This window gets no mouse moves of its own, so hover comes from Rust's pointer.
 */
export default function RecordingPreview() {
  const preview = useRecordingPreview();
  if (!preview.videoSrc) return null;
  const { durationMs, progress, isHovered, activity } = preview;

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
      <div className="absolute inset-x-3 bottom-2 h-1 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full bg-white"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <ClipDock
        preview={preview}
        isVisible={isHovered || activity !== "idle"}
      />
    </div>
  );
}

/**
 * The actions, or what Save or Copy is doing, morphing between them like the record bar. The
 * clip behind it is blurred, so it reads on any recording.
 */
function ClipDock({
  preview,
  isVisible,
}: {
  preview: Preview;
  isVisible: boolean;
}) {
  const { activity } = preview;
  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-5 flex justify-center transition-opacity duration-200",
        !isVisible && "pointer-events-none opacity-0",
      )}
    >
      <MorphPill
        active={activity === "idle" ? "actions" : activity}
        translucent
        className="backdrop-blur-xl backdrop-saturate-150"
        layerClassName="gap-1 p-1"
        layers={{
          actions: <Actions preview={preview} />,
          saving: <Message icon={<Spinner />}>Saving…</Message>,
          copying: <Message icon={<Spinner />}>Copying…</Message>,
          copied: <Message icon={<Done />}>Copied to clipboard</Message>,
          saved: (
            <>
              <Message icon={<Done />}>Saved</Message>
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
            <Message icon={<CircleAlert className="text-destructive" />}>
              <span className="max-w-64 truncate" title={preview.failure}>
                {preview.failure}
              </span>
            </Message>
          ),
        }}
      />
    </div>
  );
}

function Actions({ preview }: { preview: Preview }) {
  return (
    <>
      <Action
        name="save"
        label="Save"
        shortcut="⌘S"
        variant="ghost"
        hovered={preview.hovered}
        onClick={() => void preview.save()}
      >
        <Download />
      </Action>
      <Action
        name="copy"
        label="Copy"
        shortcut="⌘C"
        variant="ghost"
        hovered={preview.hovered}
        onClick={() => void preview.copy()}
      >
        <Copy />
      </Action>
      <Separator orientation="vertical" className="mx-1 h-5 bg-glass-border" />
      <Action
        name="edit"
        label="Edit"
        shortcut="E"
        variant="default"
        hovered={preview.hovered}
        onClick={() => void preview.edit()}
      >
        <Pencil />
      </Action>
    </>
  );
}

/** A round icon button with its name and key in a tooltip, opened by Rust's hover. */
function Action({
  name,
  label,
  shortcut,
  variant,
  hovered,
  onClick,
  children,
}: {
  name: string;
  label: string;
  shortcut: string;
  variant: "ghost" | "default";
  hovered: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip open={hovered === name}>
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

function Message({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex h-8 items-center gap-2 px-3 text-[13px] font-medium [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      {children}
    </span>
  );
}

function Done() {
  return <Check className="text-highlight" />;
}
