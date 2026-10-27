import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeOnMount } from "@/hooks/useTauri";
import type { Settings } from "@/lib/bindings";
import { type Appearance, readAppearance } from "@/lib/editor/appearance";
import { readExport } from "@/lib/editor/export";
import { NEW_PROJECT } from "@/lib/editor/project";

export function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState("");
  useInvokeOnMount("get_settings", setSettings);
  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

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
    version,
    openNotices: () => void invoke("open_notices").catch(console.error),
    openRepo: () => void invoke("open_repo").catch(console.error),
    exportSettings: readExport(settings?.export),
    newProject: settings && {
      ...NEW_PROJECT,
      appearance: readAppearance(
        (settings.appearance ?? undefined) as Partial<Appearance> | undefined,
      ),
      suggestionsMade: !settings.suggestsEdits,
    },
  };
}

export type AppSettings = ReturnType<typeof useAppSettings>;
