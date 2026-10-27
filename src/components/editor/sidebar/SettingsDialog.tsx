import type { ComponentProps, ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { Appearance } from "@/lib/editor/appearance";

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

function SettingsBody({
  app,
  appearance,
}: {
  app: AppSettings;
  appearance: Appearance;
}) {
  const { settings, change, chooseSaveFolder, exportSettings, version } = app;
  if (!settings) return null;
  const { saveFolder, suggestsEdits } = settings;
  const saved = settings.appearance !== null;
  return (
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
        </Row>
      </DialogSection>
      <DialogSection title="About">
        <Row label="Version">
          <span className="font-mono text-label text-muted-foreground">
            {version}
          </span>
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
