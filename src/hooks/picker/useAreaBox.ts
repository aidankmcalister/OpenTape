import { useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOneAtATime, useTauriEvent } from "@/hooks/useTauri";
import type { DisplayInfo } from "@/lib/bindings";
import type { Point, Rect, Size } from "@/lib/geometry";
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

/** `barSize` is the capture bar's rendered size, so it can be kept on screen. */
export function useAreaBox(
  display: DisplayInfo,
  hasBox: boolean,
  barSize: Size,
) {
  const bounds = { width: display.frame.width, height: display.frame.height };
  const [area, setArea] = useState(() => centeredArea(bounds));
  /** Null while the box is free-form. */
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const drag = useRef<{ handle: Handle; from: Point; initial: Rect } | null>(
    null,
  );
  // Return and the Record button can land together; the box records once.
  const oneAtATime = useOneAtATime();

  // A box that arrives on this display starts centered again.
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
    // Keeps the drag going when the pointer leaves the element it started on.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      handle,
      from: { x: event.clientX, y: event.clientY },
      initial,
    };
  }

  return {
    area,
    ratio,
    /** What the recording will be, in pixels. */
    size: pixelSize(area, display.scale),
    barPosition: captureBarPosition(area, barSize, bounds, display.safeTop),
    /** Null frees the box again. */
    chooseRatio: (next: Ratio | null) => {
      setRatio(next);
      if (next) setArea(fitRatio(area, next.value, bounds));
    },
    record: recordOnce,
    /** Pressing outside the box draws a new one from there. */
    surfaceProps: {
      onPointerDown: (event: PointerEvent) =>
        beginDrag(
          "se",
          { x: event.clientX, y: event.clientY, width: 0, height: 0 },
          event,
        ),
      onPointerMove: (event: PointerEvent) => {
        const ongoing = drag.current;
        if (!ongoing) return;
        const delta = {
          x: event.clientX - ongoing.from.x,
          y: event.clientY - ongoing.from.y,
        };
        // Moving keeps a chosen ratio; resizing frees the box.
        if (ongoing.handle !== "move") setRatio(null);
        setArea(dragArea(ongoing.initial, ongoing.handle, delta, bounds));
      },
      onPointerUp: () => (drag.current = null),
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
    /** For a display without the box: a click there moves the box to it. */
    claimProps: {
      onPointerDown: () =>
        void invoke("move_area", { displayId: display.id }).catch(
          console.error,
        ),
    },
  };
}
