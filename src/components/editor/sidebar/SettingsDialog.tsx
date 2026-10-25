import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogPanel, DialogSection } from "../Panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppSettings } from "@/hooks/useAppSettings";

const KEEP_FOR = [
  ["never", "Never"],
  ["30", "30 days"],
  ["90", "90 days"],
];

export default function SettingsDialog() {
  return (
    <DialogPanel
      title="Settings"
      icon={<SlidersHorizontal />}
      className="sm:max-w-130"
    >
      <SettingsBody />
    </DialogPanel>
  );
}

function SettingsBody() {
  const { settings, change, chooseSaveFolder } = useAppSettings();
  if (!settings) return null;
  const { saveFolder, deleteAfterDays } = settings;
  return (
    <>
      <DialogSection className="gap-2" title="Files">
        <div className="flex h-8 items-center justify-between gap-3">
          <span>Save exports to</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void chooseSaveFolder().catch(console.error)}
          >
            Change…
          </Button>
        </div>
        <div className="flex h-6 items-center justify-between gap-3 text-label text-muted-foreground">
          <span className="truncate font-mono" title={saveFolder ?? undefined}>
            {saveFolder ?? "Downloads"}
          </span>
          {saveFolder ? (
            <Button
              variant="link"
              size="xs"
              className="text-highlight-foreground"
              onClick={() => change({ saveFolder: null })}
            >
              Use Downloads
            </Button>
          ) : null}
        </div>
      </DialogSection>
      <DialogSection className="gap-2" title="Recordings">
        <span>Delete recordings older than</span>
        <Tabs
          value={String(deleteAfterDays ?? "never")}
          onValueChange={(value: string) =>
            change({
              deleteAfterDays: value === "never" ? null : Number(value),
            })
          }
        >
          <TabsList className="w-full">
            {KEEP_FOR.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-label text-muted-foreground">
          They go to the Trash when the app opens and when you change this, so
          you can put one back.
        </p>
      </DialogSection>
    </>
  );
}
