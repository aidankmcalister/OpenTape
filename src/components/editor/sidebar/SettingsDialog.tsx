import { type ComponentProps, type ReactNode, useState } from "react";
import {
  ArrowUpFromLine,
  Check,
  CircleDot,
  Info,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { ProgressRing } from "@/components/Pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type DialogPanel, DialogSection, Row } from "../Panel";
import { Help } from "../timeline/SettingControl";
import { ExportChoices } from "../header/ExportButton";
import type { AppSettings } from "@/hooks/useAppSettings";
import { type Update, useUpdate } from "@/hooks/useUpdate";
import type { Appearance } from "@/lib/editor/appearance";
import { shortcutLabel } from "@/lib/shortcut";
import { downloadProgress } from "@/lib/update";
import { cn } from "@/lib/utils";

const PAGES = [
  { name: "Recording", icon: CircleDot },
  { name: "Export", icon: ArrowUpFromLine },
  { name: "General", icon: Settings2 },
  { name: "About", icon: Info },
] as const;

type Page = (typeof PAGES)[number]["name"];

/** The editor's Settings: the same pages as the Settings window, in a dialog of the same size. */
export default function SettingsDialog({
  app,
  appearance,
  ...props
}: Pick<ComponentProps<typeof DialogPanel>, "open" | "onOpenChange"> & {
  app: AppSettings;
  appearance: Appearance;
}) {
  return (
    <Dialog {...props}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" aria-label="Settings" />}
      >
        <SlidersHorizontal />
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="block h-112 w-180 max-w-none overflow-hidden rounded-2xl p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SettingsPanel
          app={app}
          appearance={appearance}
          close={
            <DialogClose
              render={<Button variant="ghost" size="icon" aria-label="Close" />}
            >
              <X />
            </DialogClose>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings in pages: a sidebar and the open page, 720 by 448 so no page scrolls. The Settings
 * window shows it on its own (its window buttons sit in the sidebar's top); the editor shows it
 * in a dialog with a close button.
 */
export function SettingsPanel({
  app,
  appearance,
  close,
}: {
  app: AppSettings;
  appearance?: Appearance;
  close?: ReactNode;
}) {
  const [page, setPage] = useState<Page>("Recording");
  const update = useUpdate();
  const { settings, change, chooseSaveFolder, exportSettings } = app;
  if (!settings) return null;
  const {
    saveFolder,
    suggestsEdits,
    recordsKeys,
    hearsEveryApp,
    recordShortcut,
    countsDown,
    hidesDockIcon,
    sharesUsage,
  } = settings;
  const saved = settings.appearance !== null;
  const drags = close ? {} : { "data-tauri-drag-region": true };
  return (
    <div className="grid h-full grid-cols-[176px_1fr] text-ui">
      <nav aria-label="Settings" className="flex flex-col hairline-r">
        <div {...drags} className="h-14 shrink-0" />
        <div className="flex flex-col gap-1 px-2 pt-3">
          {PAGES.map(({ name, icon: Icon }) => (
            <Button
              key={name}
              variant="ghost"
              aria-current={page === name ? "page" : undefined}
              className="justify-start gap-2 px-2 aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
              onClick={() => setPage(name)}
            >
              <Icon />
              {name}
            </Button>
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 flex-col">
        <header
          {...drags}
          className="flex h-14 shrink-0 items-center justify-between pr-3 pl-4 hairline-b"
        >
          <h2 className="text-heading font-semibold">{page}</h2>
          {close}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {page === "Recording" ? (
            <>
              <DialogSection title="Capture">
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
                    <Help
                      text={
                        <>
                          Counts 3, 2, 1 on what you're recording.{" "}
                          <Kbd>Esc</Kbd> cancels.
                        </>
                      }
                    >
                      Count down before recording
                    </Help>
                  }
                >
                  <Switch
                    checked={countsDown}
                    onCheckedChange={(checked) =>
                      change({ countsDown: checked })
                    }
                  />
                </Row>
                <Row
                  label={
                    <Help text="Off records only the recorded window's app.">
                      Record all sound in window recordings
                    </Help>
                  }
                >
                  <Switch
                    checked={hearsEveryApp}
                    onCheckedChange={(checked) =>
                      change({ hearsEveryApp: checked })
                    }
                  />
                </Row>
                <Row label="Record keystrokes">
                  <Switch
                    checked={recordsKeys}
                    onCheckedChange={app.setRecordsKeys}
                  />
                </Row>
                <p className="text-label text-muted-foreground">
                  {recordsKeys
                    ? "Shortcuts are saved with the recording. What you type never is."
                    : "Needed to show keystrokes. Off by default."}
                </p>
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
                    onCheckedChange={(checked) =>
                      change({ suggestsEdits: checked })
                    }
                  />
                </Row>
                <Row label="Default settings">
                  {saved ? (
                    <Reset onClick={() => change({ appearance: null })}>
                      Reset
                    </Reset>
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
            </>
          ) : page === "Export" ? (
            <>
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
                    <TooltipContent>
                      {saveFolder ?? "~/Downloads"}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="secondary"
                    onClick={() => void chooseSaveFolder().catch(console.error)}
                  >
                    Change…
                  </Button>
                </Row>
              </DialogSection>
              <DialogSection title="Video">
                <ExportChoices
                  inRows
                  settings={exportSettings}
                  change={(part) =>
                    change({ export: { ...exportSettings, ...part } })
                  }
                />
              </DialogSection>
            </>
          ) : page === "General" ? (
            <>
              <DialogSection title="Dock">
                <Row
                  label={
                    <Help text="OpenTape stays in the menu bar. The icon comes back while the editor is open.">
                      Hide Dock icon
                    </Help>
                  }
                >
                  <Switch
                    checked={hidesDockIcon}
                    onCheckedChange={(checked) =>
                      change({ hidesDockIcon: checked })
                    }
                  />
                </Row>
              </DialogSection>
              <DialogSection title="Privacy">
                <Row
                  label={
                    <Help text="Counts launches, recordings, pauses, restarts and exports, with the app version, export format and whether you recorded a screen, window or area. Never what you record, file names or anything that identifies you.">
                      Share anonymous usage
                    </Help>
                  }
                >
                  <Switch
                    checked={sharesUsage}
                    onCheckedChange={(checked) =>
                      change({ sharesUsage: checked })
                    }
                  />
                </Row>
              </DialogSection>
            </>
          ) : (
            <DialogSection>
              <Row label="Version">
                <span className="font-mono text-label text-muted-foreground">
                  {update.currentVersion}
                </span>
              </Row>
              <Row label="Updates">
                <UpdateState update={update} />
              </Row>
              <Row label="Source code">
                <Button variant="secondary" onClick={app.openRepo}>
                  Open on GitHub
                </Button>
              </Row>
              <Row label="MIT license">
                <Button variant="secondary" onClick={app.openNotices}>
                  Third-party notices
                </Button>
              </Row>
            </DialogSection>
          )}
        </div>
      </div>
    </div>
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
