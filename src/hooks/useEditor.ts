import { useEffect, useState } from "react";
import { usePlayback } from "@/hooks/usePlayback";
import {
  clampAmount,
  DEFAULT_LOOK,
  type Amount,
  type Fill,
  type Look,
} from "@/lib/look";
import {
  addRegion,
  amountAt,
  type Region,
  type RegionKind,
} from "@/lib/timeline";

/**
 * Everything the editor's panels, stage and timeline share: playback, the look, and the zoom and
 * speed regions. The zoom and speed at the playhead come from the regions.
 */
export function useEditor(videoSrc: string) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const playback = usePlayback(videoSrc);
  const { currentMs, durationMs, nowMs, setRate } = playback;

  const rate = amountAt(regions, "speed", currentMs);
  useEffect(() => setRate(rate), [rate, setRate]);

  function add(kind: RegionKind) {
    setRegions((current) => addRegion(current, kind, nowMs(), durationMs));
  }

  function removeSelected() {
    setRegions((current) =>
      current.filter((region) => region.id !== selectedId),
    );
    setSelectedId(null);
  }

  useEditorKeys({ togglePlay: playback.togglePlay, add, removeSelected });

  return {
    playback,
    rate,
    zoom: amountAt(regions, "zoom", currentMs),
    regions,
    selectedId,
    select: setSelectedId,
    add,
    look,
    setFill: (fill: Fill) => setLook((current) => ({ ...current, fill })),
    setAmount: (amount: Amount, value: number) =>
      setLook((current) => ({
        ...current,
        [amount]: clampAmount(amount, value),
      })),
    resetLook: () => setLook(DEFAULT_LOOK),
  };
}

export type Editor = ReturnType<typeof useEditor>;

const ADD_KEYS: Record<string, RegionKind> = { z: "zoom", s: "speed" };

/** Space plays and pauses, Z and S add a region at the playhead, Delete removes the selected one. */
function useEditorKeys(actions: {
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
