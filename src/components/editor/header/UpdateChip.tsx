import { useState } from "react";
import { ArrowUp, CircleAlert, FileText, RotateCw } from "lucide-react";
import { ProgressRing } from "@/components/Pill";
import UpdateIcon from "@/components/UpdateIcon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdate } from "@/hooks/useUpdate";
import { downloadProgress, newsOf, whatIsNew } from "@/lib/update";
import { cn } from "@/lib/utils";

export default function UpdateChip() {
  const { status, currentVersion, install, cancel, restart, openReleaseNotes } =
    useUpdate();
  const [isOpen, setIsOpen] = useState(false);
  const news = newsOf(status);
  if (!news) return null;
  const version = "version" in status ? status.version : null;
  const progress = downloadProgress(status);
  const isFailed = status.state === "failed";
  const close = () => setIsOpen(false);
  const [title, detail] = progress
    ? [`Downloading ${version}`, `${progress.detail}. You can keep editing.`]
    : status.state === "ready"
      ? ["Ready to restart", `OpenTape ${version}. Projects are saved first.`]
      : isFailed
        ? ["Update failed", "Check your connection and try again."]
        : [
            "Update available",
            `OpenTape ${version}. You have ${currentVersion}.`,
          ];
  const notes = status.state === "available" ? whatIsNew(status.notes) : [];

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            size="pill-sm"
            className={cn(
              "mr-1 px-3 tabular-nums",
              isFailed &&
                "bg-destructive/16 text-destructive hover:bg-destructive/24",
            )}
          />
        }
      >
        {progress ? (
          <ProgressRing fraction={progress.percent / 100} className="size-4" />
        ) : status.state === "ready" ? (
          <RotateCw />
        ) : isFailed ? (
          <CircleAlert />
        ) : (
          <ArrowUp />
        )}
        {progress ? (
          <span className="w-9 text-left">{progress.percent}%</span>
        ) : status.state === "ready" ? (
          "Restart"
        ) : isFailed ? (
          "Retry"
        ) : (
          "Update"
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-4 p-4">
        <div className="flex items-center gap-3">
          <UpdateIcon
            news={news}
            percent={progress?.percent}
            className="size-10 rounded-lg"
          />
          <div className="flex min-w-0 flex-col">
            <PopoverTitle className="text-ui">{title}</PopoverTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {detail}
            </span>
          </div>
        </div>
        {notes.length ? (
          <div className="flex flex-col gap-2 text-xs">
            <span className="text-muted-foreground">What is new</span>
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <li
                  key={note}
                  className="flex items-center gap-2 before:size-1 before:shrink-0 before:rounded-full before:bg-highlight"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          {progress ? (
            <>
              <span className="mr-3 h-1 flex-1 overflow-hidden rounded-full bg-progress-track">
                <span
                  className="block h-full bg-primary transition-[width]"
                  style={{ width: `${progress.percent}%` }}
                />
              </span>
              <Button variant="ghost" size="pill-sm" onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {isFailed ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-round"
                        aria-label="Release notes"
                        onClick={openReleaseNotes}
                      />
                    }
                  >
                    <FileText />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Release notes</TooltipContent>
                </Tooltip>
              )}
              <span className="flex-1" />
              <Button variant="ghost" size="pill-sm" onClick={close}>
                Later
              </Button>
              <Button
                variant="primary"
                size="pill-sm"
                onClick={status.state === "ready" ? restart : install}
              >
                {status.state === "ready"
                  ? "Restart"
                  : isFailed
                    ? "Try again"
                    : "Update"}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
