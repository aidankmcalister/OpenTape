import { SettingsBody } from "@/components/editor/sidebar/SettingsDialog";
import { useAppSettings } from "@/hooks/useAppSettings";

export default function Settings() {
  const app = useAppSettings();
  return (
    <main className="h-screen overflow-y-auto bg-background">
      <SettingsBody app={app} />
    </main>
  );
}
