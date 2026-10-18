import { useEffect, useState } from "react";
import {
  clampAmount,
  DEFAULT_LOOK,
  type Amount,
  type Fill,
  type Look,
} from "@/features/editor/lib/look";
import {
  addRegion,
  amountAt,
  type Region,
  type RegionKind,
} from "@/features/editor/lib/regions";
import { useEditorKeys } from "./useEditorKeys";
import { usePlayback } from "./usePlayback";

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
