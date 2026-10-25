import { useState, type PointerEvent } from "react";
import { followPointer } from "@/hooks/usePointerHover";
import { invoke } from "@tauri-apps/api/core";
import { useOneAtATime, useTauriEvent } from "@/hooks/useTauri";
import type { DisplayInfo } from "@/lib/bindings";
import type { Rect, Size } from "@/lib/geometry";
import {
  captureBarPosition,
  centeredArea,
  dragArea,
  fitRatio,
  pixelSize,
  type Handle,
  type Ratio,
} from "@/lib/picker/area";
import { record } from "@/lib/picker/view";

export function useAreaBox(
  display: DisplayInfo,
  hasBox: boolean,
  barSize: Size,
) {
  const bounds = { width: display.frame.width, height: display.frame.height };
  const [area, setArea] = useState(() => centeredArea(bounds));
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const oneAtATime = useOneAtATime();

  const [hadBox, setHadBox] = useState(hasBox);
  if (hasBox !== hadBox) {
    setHadBox(hasBox);
    if (hasBox) setArea(centeredArea(bounds));
  }

  const recordOnce = () =>
    void oneAtATime(() =>
      record({ kind: "area", displayId: display.id, ...area }),
    ).catch(console.error);
  useTauriEvent(
    "picker-key",
    (key) => {
      if (key === "Enter" && hasBox) recordOnce();
    },
    "window",
  );

  function beginDrag(handle: Handle, initial: Rect, event: PointerEvent) {
    event.stopPropagation();
    const { clientX: x, clientY: y } = event;
    followPointer((moved) => {
      if (handle !== "move") setRatio(null);
      const delta = { x: moved.clientX - x, y: moved.clientY - y };
      setArea(dragArea(initial, handle, delta, bounds));
    });
  }

  return {
    area,
    ratio,
    size: pixelSize(area, display.scale),
    barPosition: captureBarPosition(area, barSize, bounds, display.safeTop),
    chooseRatio: (next: Ratio | null) => {
      setRatio(next);
      if (next) setArea(fitRatio(area, next.value, bounds));
    },
    record: recordOnce,
    surfaceProps: {
      onPointerDown: (event: PointerEvent) =>
        beginDrag(
          "se",
          { x: event.clientX, y: event.clientY, width: 0, height: 0 },
          event,
        ),
    },
    boxProps: {
      onPointerDown: (event: PointerEvent) => beginDrag("move", area, event),
    },
    handleProps: (handle: Handle) => ({
      onPointerDown: (event: PointerEvent) => beginDrag(handle, area, event),
    }),
    barProps: {
      onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    },
    claimProps: {
      onPointerDown: () =>
        void invoke("move_area", { displayId: display.id }).catch(
          console.error,
        ),
    },
  };
}
