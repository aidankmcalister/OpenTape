import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useRustValue } from "@/hooks/useTauri";
import type { UpdateStatus } from "@/lib/bindings";

function run(command: string) {
  return () => void invoke(command).catch(console.error);
}

export function useUpdate() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "checking" });
  const [currentVersion, setCurrentVersion] = useState("");
  useRustValue("update_status", "update-status", setStatus);
  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  return {
    status,
    currentVersion,
    check: run("check_for_update"),
    install: run("install_update"),
    cancel: run("cancel_update"),
    restart: run("relaunch"),
    openReleaseNotes: run("open_release_notes"),
  };
}

export type Update = ReturnType<typeof useUpdate>;
