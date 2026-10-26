import type { ComponentProps, ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { DialogPanel, DialogSection, SwitchField } from "../Panel";
import { ExportChoices } from "../header/ExportButton";
import type { AppSettings } from "@/hooks/useAppSettings";
import type { Appearance } from "@/lib/editor/appearance";
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
      <div className="max-h-[75vh] overflow-y-auto">
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
      <DialogSection className="gap-2" title="Files">
        <Row label="Save exports to">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void chooseSaveFolder().catch(console.error)}
          >
            Change…
          </Button>
        </Row>
        <Detail
          mono
          value={saveFolder ?? "Downloads"}
          reset={saveFolder ? "Use Downloads" : null}
          onReset={() => change({ saveFolder: null })}
        />
      </DialogSection>
      <DialogSection className="gap-3 pb-4" title="Export">
        <ExportChoices
          settings={exportSettings}
          change={(part) => change({ export: { ...exportSettings, ...part } })}
        />
      </DialogSection>
      <DialogSection className="gap-2" title="New recordings">
        <SwitchField
          label="Suggest zooms and speed-ups"
          checked={suggestsEdits}
          onChange={(checked) => change({ suggestsEdits: checked })}
        />
        <Row label="Default settings">
          <Button
            variant="secondary"
            size="sm"
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
        <Detail
          value={saved ? "From a recording" : "Built-in"}
          reset={saved ? "Reset" : null}
          onReset={() => change({ appearance: null })}
        />
      </DialogSection>
      <DialogSection className="gap-2" title="About">
        <Row label="Version">
          <span className="font-mono text-label text-muted-foreground">
            {version}
          </span>
        </Row>
        <Row label="MIT license">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => invoke("open_notices").catch(console.error)}
          >
            Third-party notices
          </Button>
        </Row>
      </DialogSection>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Detail({
  mono,
  value,
  reset,
  onReset,
}: {
  mono?: boolean;
  value: string;
  reset: string | null;
  onReset: () => void;
}) {
  return (
    <div className="flex h-6 items-center justify-between gap-3 text-label text-muted-foreground">
      <span className={cn("truncate", mono && "font-mono")} title={value}>
        {value}
      </span>
      {reset ? (
        <Button
          variant="link"
          size="xs"
          className="text-highlight-foreground"
          onClick={onReset}
        >
          {reset}
        </Button>
      ) : null}
    </div>
  );
}
