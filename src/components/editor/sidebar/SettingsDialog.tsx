import type { ComponentProps } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogPanel, DialogSection } from "../Panel";
import { useAppSettings } from "@/hooks/useAppSettings";

export default function SettingsDialog(
  props: Pick<ComponentProps<typeof DialogPanel>, "open" | "onOpenChange">,
) {
  const app = useAppSettings();
  return (
    <DialogPanel
      {...props}
      title="Settings"
      icon={<SlidersHorizontal />}
      className="sm:max-w-130"
    >
      <SettingsBody app={app} />
    </DialogPanel>
  );
}

function SettingsBody({ app }: { app: ReturnType<typeof useAppSettings> }) {
  const { settings, change, chooseSaveFolder } = app;
  if (!settings) return null;
  const { saveFolder } = settings;
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
    </>
  );
}
