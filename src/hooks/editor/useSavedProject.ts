import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeOnMount } from "@/hooks/useTauri";
import { projectJson, readProject } from "@/lib/editor/project";
import type { Edits } from "./useProject";

export function useSavedProject(edits: Edits) {
  const [isLoaded, setIsLoaded] = useState(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useInvokeOnMount<string | null>("load_project", (json) => {
    edits.load(readProject(json));
    setIsLoaded(true);
  });
  const json = isLoaded ? projectJson(edits.saved) : null;
  useEffect(() => {
    if (json === null) return;
    saving.current = saving.current
      .then(() => invoke("save_project", { json }))
      .catch(console.error);
  }, [json]);
}
