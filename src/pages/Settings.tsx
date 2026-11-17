import { SettingsPanel } from "@/components/editor/sidebar/SettingsDialog";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useShowWhenReady } from "@/hooks/useTauri";

export default function Settings() {
  const app = useAppSettings();
  useShowWhenReady();
  return (
    <main className="h-screen bg-background">
      <SettingsPanel app={app} />
    </main>
  );
}
