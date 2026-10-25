import type { ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppSettings } from "@/hooks/useAppSettings";

const KEEP_FOR = [
  ["never", "Never"],
  ["30", "30 days"],
  ["90", "90 days"],
];

export default function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" aria-label="Settings" />}
      >
        <SlidersHorizontal />
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-130">
        <header className="flex h-14 items-center justify-between border-b border-hairline pr-3 pl-4">
          <DialogTitle className="text-heading font-semibold">
            Settings
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon" aria-label="Close" />}
          >
            <X />
          </DialogClose>
        </header>
        <SettingsBody />
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody() {
  const { settings, change, chooseSaveFolder } = useAppSettings();
  if (!settings) return null;
  const { saveFolder, deleteAfterDays } = settings;
  return (
    <>
      <Group title="Files">
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
      </Group>
      <Group title="Recordings">
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
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3 text-ui not-first-of-type:border-t not-first-of-type:border-hairline">
      <h3 className="flex h-8 items-center font-semibold">{title}</h3>
      {children}
    </section>
  );
}
