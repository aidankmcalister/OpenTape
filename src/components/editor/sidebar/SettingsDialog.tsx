import type { ComponentProps, ReactNode } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { ProgressRing } from "@/components/Pill";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DialogPanel, DialogSection, Row } from "../Panel";
import { Help } from "../timeline/SettingControl";
import { ExportChoices } from "../header/ExportButton";
import type { AppSettings } from "@/hooks/useAppSettings";
import { type Update, useUpdate } from "@/hooks/useUpdate";
import type { Appearance } from "@/lib/editor/appearance";
import { shortcutLabel } from "@/lib/shortcut";
import { downloadProgress } from "@/lib/update";
import { cn } from "@/lib/utils";

export default function SettingsDialog({
  app,
  appearance,
  ...props
}: Pick<ComponentProps<typeof DialogPanel>, "open" | "onOpenChange"> & {
  app: AppSettings;
  appearance: Appearance;
}) {
  return (
    <DialogPanel
      {...props}
      title="Settings"
      icon={<SlidersHorizontal />}
      className="sm:max-w-130"
    >
      <div className="max-h-[calc(100vh-5rem)] overflow-y-auto">
        <SettingsBody app={app} appearance={appearance} />
      </div>
    </DialogPanel>
  );
}

export function SettingsBody({
  app,
  appearance,
}: {
  app: AppSettings;
  appearance?: Appearance;
}) {
  const { settings, change, chooseSaveFolder, exportSettings } = app;
  const update = useUpdate();
  if (!settings) return null;
  const { saveFolder, suggestsEdits, recordShortcut, countsDown } = settings;
  const saved = settings.appearance !== null;
  return (
    <>
      <DialogSection title="Recording">
        <Row label="Start or stop recording">
          <Kbd>{shortcutLabel(recordShortcut)}</Kbd>
          <Button
            variant="secondary"
            onClick={() => app.setIsSettingShortcut(true)}
            onKeyDown={app.pressShortcut}
            onBlur={() => app.setIsSettingShortcut(false)}
          >
            {app.isSettingShortcut ? "Press keys…" : "Change…"}
          </Button>
        </Row>
        <Row
          label={
            <Help text="Counts 3, 2, 1 on what you're recording. Esc cancels.">
              Count down before recording
            </Help>
          }
        >
          <Switch
            checked={countsDown}
            onCheckedChange={(checked) => change({ countsDown: checked })}
          />
        </Row>
      </DialogSection>
      <DialogSection title="Files">
        <Row label="Save exports to">
          {saveFolder ? (
            <Reset onClick={() => change({ saveFolder: null })}>
              Use Downloads
            </Reset>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="max-w-40 truncate font-mono text-label text-muted-foreground" />
              }
            >
              {saveFolder?.split("/").pop() ?? "Downloads"}
            </TooltipTrigger>
            <TooltipContent>{saveFolder ?? "~/Downloads"}</TooltipContent>
          </Tooltip>
          <Button
            variant="secondary"
            onClick={() => void chooseSaveFolder().catch(console.error)}
          >
            Change…
          </Button>
        </Row>
      </DialogSection>
      <DialogSection title="Export">
        <ExportChoices
          inRows
          settings={exportSettings}
          change={(part) => change({ export: { ...exportSettings, ...part } })}
        />
      </DialogSection>
      <DialogSection title="New recordings">
        <Row
          label={
            <Help text="Adds Auto zoom and Typing suggestions to new recordings.">
              Suggest zooms and speed-ups
            </Help>
          }
        >
          <Switch
            checked={suggestsEdits}
            onCheckedChange={(checked) => change({ suggestsEdits: checked })}
          />
        </Row>
        <Row label="Default settings">
          {saved ? (
            <Reset onClick={() => change({ appearance: null })}>Reset</Reset>
          ) : null}
          <span className="text-label text-muted-foreground">
            {saved ? "From a recording" : "Built-in"}
          </span>
          {appearance ? (
            <Button
              variant="secondary"
              onClick={() =>
                change({
                  appearance: {
                    ...appearance,
                    fill: { ...appearance.fill, image: null },
                  },
                })
              }
            >
              Set from this recording
            </Button>
          ) : null}
        </Row>
      </DialogSection>
      <DialogSection title="About">
        <Row label="Version">
          <span className="font-mono text-label text-muted-foreground">
            {update.currentVersion}
          </span>
        </Row>
        <Row label="Updates">
          <UpdateState update={update} />
        </Row>
        <Row label="MIT license">
          <Button variant="secondary" onClick={app.openNotices}>
            Third-party notices
          </Button>
        </Row>
      </DialogSection>
    </>
  );
}

function UpdateState({
  update: { status, check, install, restart },
}: {
  update: Update;
}) {
  const progress = downloadProgress(status);
  if (progress)
    return (
      <span className="flex items-center gap-2 text-label text-muted-foreground">
        <ProgressRing fraction={progress.percent / 100} className="size-3.5" />
        Downloading,
        <span className="w-10 text-right tabular-nums">
          {progress.percent}%
        </span>
      </span>
    );
  if (status.state === "available" || status.state === "ready")
    return (
      <>
        <span className="text-label text-highlight-foreground">
          {status.version} {status.state === "ready" ? "ready" : "available"}
        </span>
        <Button
          variant="primary"
          onClick={status.state === "ready" ? restart : install}
        >
          {status.state === "ready" ? "Restart" : "Update"}
        </Button>
      </>
    );
  const isFailed = status.state === "failed";
  return (
    <>
      <span
        className={cn(
          "flex items-center gap-1.5 text-label text-muted-foreground [&_svg]:size-3.5",
          isFailed && "text-destructive",
        )}
      >
        {status.state === "checking" ? (
          <Spinner />
        ) : isFailed ? null : (
          <Check />
        )}
        {status.state === "checking"
          ? "Checking"
          : isFailed
            ? "Update failed"
            : "Up to date"}
      </span>
      <Button
        variant="secondary"
        disabled={status.state === "checking"}
        onClick={isFailed && status.version ? install : check}
      >
        {isFailed ? "Retry" : "Check now"}
      </Button>
    </>
  );
}

function Reset({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="link"
      size="xs"
      className="text-highlight-foreground"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
