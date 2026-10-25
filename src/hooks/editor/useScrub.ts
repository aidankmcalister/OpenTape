import { useState, type PointerEvent } from "react";
import { type Box, msAtX } from "@/lib/editor/timeline";

export function useScrub(durationMs: number, seek: (ms: number) => void) {
  function seekTo(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    seek(msAtX(event.clientX - bounds.left, bounds.width, durationMs));
  }

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      seekTo(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        seekTo(event);
      }
    },
  };
}

export type Skim = ReturnType<typeof useSkim>;

export function useSkim(durationMs: number, skim: (ms: number | null) => void) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  function msAt(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return msAtX(event.clientX - bounds.left, bounds.width, durationMs);
  }

  return {
    hoverMs,
    msAt,
    skimProps: {
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const ms = msAt(event);
        setHoverMs(ms);
        skim(ms);
      },
      onPointerLeave: () => {
        setHoverMs(null);
        skim(null);
      },
    },
  };
}

export function useMarquee(
  onBox: (box: Box, width: number) => void,
  onClick: (x: number, width: number) => void,
) {
  const [box, setBox] = useState<Box | null>(null);

  function pointAt(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: bounds.width,
    };
  }

  return {
    box,
    marqueeProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = pointAt(event);
        setBox({ x0: x, y0: y, x1: x, y1: y });
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (!box || !event.currentTarget.hasPointerCapture(event.pointerId))
          return;
        const { x, y, width } = pointAt(event);
        const next = { ...box, x1: x, y1: y };
        setBox(next);
        onBox(next, width);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (!box) return;
        const moved = Math.abs(box.x1 - box.x0) + Math.abs(box.y1 - box.y0);
        if (moved < 4) onClick(box.x0, pointAt(event).width);
        setBox(null);
      },
    },
  };
}
