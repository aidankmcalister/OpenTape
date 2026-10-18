import { useEffect, useRef, useState, type PointerEvent } from "react";
import { emit } from "@tauri-apps/api/event";
import { EVENTS, subscribe } from "@/lib/events";
import {
  centeredArea,
  dragArea,
  fitRatio,
  panelPosition,
  setAreaField,
  type Handle,
  type Point,
  type Ratio,
  type Rect,
  type Size,
} from "@/lib/geometry";
import { pick, type DisplayInfo } from "@/lib/picker";
import { usePickerKey } from "./usePickerKey";

type Drag = { handle: Handle; from: Point; initial: Rect };
type PointerHandler = (event: PointerEvent) => void;

export type AreaBox = {
  /** Only one display holds the box. The others spread `claimProps` to take it. */
  hasBox: boolean;
  area: Rect;
  /** Null while the box is free-form. */
  ratio: Ratio | null;
  barPosition: Point;
  setSize: (side: "width" | "height", value: number) => void;
  chooseRatio: (ratio: Ratio) => void;
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
  startsHere: boolean,
  barSize: Size,
): AreaBox {
  const bounds = { width: display.frame.width, height: display.frame.height };
  const [hasBox, setHasBox] = useState(startsHere);
  const [area, setArea] = useState(() => centeredArea(bounds));
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(
    () =>
      subscribe<number>(EVENTS.areaMoved, (displayId) => {
        const movedHere = displayId === display.id;
        setHasBox(movedHere);
        if (movedHere) setArea(centeredArea(display.frame));
      }),
    [display],
  );

  const start = () =>
    void pick({ kind: "area", displayId: display.id, ...area });
  usePickerKey((key) => {
    if (key === "Enter" && hasBox) start();
  });

  function beginDrag(handle: Handle, initial: Rect): PointerHandler {
    return (event) => {
      event.stopPropagation();
      // Keeps the drag going when the pointer leaves the element it started on.
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      drag.current = {
        handle,
        from: { x: event.clientX, y: event.clientY },
        initial,
      };
    };
  }

  const beginDrawing: PointerHandler = (event) =>
    beginDrag("se", {
      x: event.clientX,
      y: event.clientY,
      width: 0,
      height: 0,
    })(event);

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
    hasBox,
    area,
    ratio,
    barPosition: panelPosition(area, barSize, bounds),
    setSize: (side, value) => {
      setRatio(null);
      setArea(setAreaField(area, side, value, bounds));
    },
    chooseRatio: (next) => {
      setRatio(next);
      setArea(fitRatio(area, next.value, bounds));
    },
    start,
    surfaceProps: {
      onPointerDown: beginDrawing,
      onPointerMove: continueDrag,
      onPointerUp: () => (drag.current = null),
    },
    boxProps: { onPointerDown: beginDrag("move", area) },
    handleProps: (handle) => ({ onPointerDown: beginDrag(handle, area) }),
    barProps: { onPointerDown: (event) => event.stopPropagation() },
    claimProps: {
      onPointerDown: () => void emit(EVENTS.areaMoved, display.id),
    },
  };
}
