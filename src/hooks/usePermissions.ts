import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Permission, Permissions } from "@/lib/bindings";

const CHECK_EVERY_MS = 1000;

export function usePermissions() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [opened, setOpened] = useState<Permission[]>([]);

  useEffect(() => {
    let isMounted = true;
    let shown = "";
    const read = () =>
      invoke<Permissions>("permissions")
        .then((next) => {
          const json = JSON.stringify(next);
          if (!isMounted || json === shown) return;
          shown = json;
          setPermissions(next);
        })
        .catch(console.error);
    void read();
    const interval = setInterval(() => void read(), CHECK_EVERY_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return {
    permissions,
    opened,
    allow: (permission: Permission) => {
      setOpened((current) => [...current, permission]);
      invoke("allow", { permission }).catch(console.error);
    },
    showWindow: () => void invoke("show_permissions").catch(console.error),
    finish: () => void invoke("finish_setup").catch(console.error),
    restart: () => void invoke("relaunch").catch(console.error),
  };
}
