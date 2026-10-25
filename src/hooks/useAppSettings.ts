import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeOnMount } from "@/hooks/useTauri";
import type { Settings } from "@/lib/bindings";

export function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useInvokeOnMount("get_settings", setSettings);

  function change(part: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...part };
    setSettings(next);
    invoke("set_settings", { settings: next }).catch(console.error);
  }

  return {
    settings,
    change,
    chooseSaveFolder: async () => {
      const folder = await invoke<string | null>("choose_save_folder");
      if (folder) change({ saveFolder: folder });
    },
  };
}
