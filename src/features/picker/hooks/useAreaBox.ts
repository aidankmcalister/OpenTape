import { useRef, useState, type PointerEvent } from "react";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import type { DisplayInfo } from "@/lib/bindings/DisplayInfo";
import { EVENTS } from "@/lib/events";
import type { Point, Rect, Size } from "@/lib/geometry";
import {
  centeredArea,
  dragArea,
  fitRatio,
  panelPosition,
  pixelSize,
  type Handle,
  type Ratio,
} from "@/features/picker/lib/area";
import { moveArea, record, type PickerKey } from "@/features/picker/lib/picker";

type Drag = { handle: Handle; from: Point; initial: Rect };
type PointerHandler = (event: PointerEvent) => void;

type AreaBox = {
  area: Rect;
  /** Null while the box is free-form. */
  ratio: Ratio | null;
  /** What the recording will be, in pixels. */
  size: Size;
  barPosition: Point;
  /** Null frees the box again. */
  chooseRatio: (ratio: Ratio | null) => void;
  start: () => void;
  surfaceProps: {
    onPointerDown: PointerHandler;
    onPointerMove: PointerHandler;
    onPointerUp: () => void;
  };
  boxProps: { onPointerDown: PointerHandler };
  handleProps: (handle: Handle) => { onPointerDown: PointerHandler };
  barProps: { onPointerDown: PointerHandler };
  claimProps: { onPointerDown: () => void };
};

export function useAreaBox(
  display: DisplayInfo,
  hasBox: boolean,
  barSize: Size,
): AreaBox {
  const bounds = { width: display.frame.width, height: display.frame.height };
  const [area, setArea] = useState(() => centeredArea(bounds));
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const drag = useRef<Drag | null>(null);

  // A box that arrives on this display starts centered again.
  const [hadBox, setHadBox] = useState(hasBox);
  if (hasBox !== hadBox) {
    setHadBox(hasBox);
    if (hasBox) setArea(centeredArea(bounds));
  }

  const start = () =>
    void record({ kind: "area", displayId: display.id, ...area });
  useTauriEvent<PickerKey>(
    EVENTS.pickerKey,
    (key) => {
      if (key === "Enter" && hasBox) start();
    },
    "window",
  );

  function beginDrag(handle: Handle, initial: Rect, event: PointerEvent) {
    event.stopPropagation();
    // Keeps the drag going when the pointer leaves the element it started on.
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = {
      handle,
      from: { x: event.clientX, y: event.clientY },
      initial,
    };
  }

  const beginDrawing: PointerHandler = (event) =>
    beginDrag(
      "se",
      { x: event.clientX, y: event.clientY, width: 0, height: 0 },
      event,
    );

  const continueDrag: PointerHandler = (event) => {
    const current = drag.current;
    if (!current) return;
    const delta = {
      x: event.clientX - current.from.x,
      y: event.clientY - current.from.y,
    };
    if (current.handle !== "move") setRatio(null);
    setArea(dragArea(current.initial, current.handle, delta, bounds));
  };

  return {
    area,
    ratio,
    size: pixelSize(area, display.size.width / display.frame.width),
    barPosition: panelPosition(area, barSize, bounds, display.safeTop),
    chooseRatio: (next) => {
      setRatio(next);
      if (next) setArea(fitRatio(area, next.value, bounds));
    },
    start,
    surfaceProps: {
      onPointerDown: beginDrawing,
      onPointerMove: continueDrag,
      onPointerUp: () => (drag.current = null),
    },
    boxProps: { onPointerDown: (event) => beginDrag("move", area, event) },
    handleProps: (handle) => ({
      onPointerDown: (event) => beginDrag(handle, area, event),
    }),
    barProps: { onPointerDown: (event) => event.stopPropagation() },
    claimProps: { onPointerDown: () => void moveArea(display.id) },
  };
}
