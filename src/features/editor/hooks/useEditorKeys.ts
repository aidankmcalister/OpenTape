import { useEffect } from "react";
import type { RegionKind } from "@/features/editor/lib/regions";

const ADD_KEYS: Record<string, RegionKind> = { z: "zoom", s: "speed" };

/** Space plays and pauses, Z and S add a region at the playhead, Delete removes the selected one. */
export function useEditorKeys(actions: {
  togglePlay: () => void;
  add: (kind: RegionKind) => void;
  removeSelected: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.target instanceof HTMLInputElement
      ) {
        return;
      }
      const kind = ADD_KEYS[event.key.toLowerCase()];
      if (event.key === " ") actions.togglePlay();
      else if (kind) actions.add(kind);
      else if (event.key === "Delete" || event.key === "Backspace") {
        actions.removeSelected();
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
