import { SettingsBody } from "@/components/editor/sidebar/SettingsDialog";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useShowWhenReady } from "@/hooks/useTauri";

export default function Settings() {
  const app = useAppSettings();
  useShowWhenReady();
  return (
    <main className="flex h-screen flex-col bg-background">
      <header
        data-tauri-drag-region
        className="flex h-title-bar shrink-0 items-center pl-traffic-lights text-muted-foreground"
      >
        Settings
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsBody app={app} />
      </div>
    </main>
  );
}
