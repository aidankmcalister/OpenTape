import { useRef, useState, type PointerEvent } from "react";
import { clamp } from "@/lib/geometry";
import { TIMELINE_LIMIT_PX } from "@/lib/editor/timeline";

const KEY = "screen-recorder:timeline-limit";
const PREVIEW_MIN_PX = 240;

export function useTimelineLimit(neededPx: number) {
  const [limitPx, setLimitPx] = useState(read);
  const [draggingPx, setDraggingPx] = useState<number | null>(null);
  const drag = useRef<{ fromY: number; fromPx: number; maxPx: number } | null>(
    null,
  );

  function save(px: number) {
    setLimitPx(px);
    try {
      localStorage.setItem(KEY, String(px));
    } catch {
      return;
    }
  }

  return {
    limitPx,
    draggingPx,
    thumbProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const column = event.currentTarget.parentElement?.parentElement;
        const roomPx = (column?.clientHeight ?? 0) - PREVIEW_MIN_PX;
        const fromPx = Math.min(limitPx, neededPx);
        drag.current = {
          fromY: event.clientY,
          fromPx,
          maxPx: Math.max(TIMELINE_LIMIT_PX.min, Math.min(roomPx, neededPx)),
        };
        setDraggingPx(fromPx);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current) return;
        const px = clamp(
          Math.round(current.fromPx + current.fromY - event.clientY),
          TIMELINE_LIMIT_PX.min,
          current.maxPx,
        );
        save(px);
        setDraggingPx(px);
      },
      onPointerUp: () => {
        drag.current = null;
        setDraggingPx(null);
      },
      onDoubleClick: () => save(TIMELINE_LIMIT_PX.initial),
    },
  };
}

function read(): number {
  try {
    const px = Number(localStorage.getItem(KEY));
    return px >= TIMELINE_LIMIT_PX.min ? px : TIMELINE_LIMIT_PX.initial;
  } catch {
    return TIMELINE_LIMIT_PX.initial;
  }
}
