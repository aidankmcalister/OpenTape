import { type KeyboardEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRustValue } from "@/hooks/useTauri";
import type { Settings } from "@/lib/bindings";
import { type Appearance, readAppearance } from "@/lib/editor/appearance";
import { readExport } from "@/lib/editor/export";
import { NEW_PROJECT } from "@/lib/editor/project";
import { shortcutFromKey } from "@/lib/shortcut";

export function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isSettingShortcut, setIsSettingShortcut] = useState(false);
  useRustValue("get_settings", "settings-changed", setSettings);

  function change(part: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...part };
    setSettings(next);
    invoke("set_settings", { settings: next }).catch((err) => {
      console.error(err);
      setSettings(settings);
    });
  }

  return {
    settings,
    change,
    isSettingShortcut,
    setIsSettingShortcut,
    pressShortcut: (event: KeyboardEvent) => {
      if (!isSettingShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcutFromKey(event);
      if (event.key === "Escape" || shortcut) setIsSettingShortcut(false);
      if (shortcut) change({ recordShortcut: shortcut });
    },
    chooseSaveFolder: async () => {
      const folder = await invoke<string | null>("choose_save_folder");
      if (folder) change({ saveFolder: folder });
    },
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
