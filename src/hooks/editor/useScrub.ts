import { useState, type PointerEvent } from "react";
import { followPointer } from "@/hooks/usePointerHover";
import { type Box, msAtX } from "@/lib/editor/timeline";

export function useScrub(durationMs: number, seek: (ms: number) => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const track = event.currentTarget.closest("[data-track]");
      if (!track) return;
      const { left, width } = track.getBoundingClientRect();
      const seekAt = (x: number) => seek(msAtX(x - left, width, durationMs));
      seekAt(event.clientX);
      followPointer((moved) => seekAt(moved.clientX));
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
  /** `isAdding`: ⇧ was held, so the box adds to the selection. */
  onBox: (box: Box, width: number, isAdding: boolean) => void,
  onClick: (x: number, width: number) => void,
) {
  const [box, setBox] = useState<Box | null>(null);
  return {
    box,
    marqueeProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const { left, top, width } =
          event.currentTarget.getBoundingClientRect();
        const start = { x0: event.clientX - left, y0: event.clientY - top };
        let latest = { ...start, x1: start.x0, y1: start.y0 };
        setBox(latest);
        followPointer(
          (moved) => {
            latest = {
              ...start,
              x1: moved.clientX - left,
              y1: moved.clientY - top,
            };
            setBox(latest);
            onBox(latest, width, event.shiftKey);
          },
          () => {
            const travel =
              Math.abs(latest.x1 - latest.x0) + Math.abs(latest.y1 - latest.y0);
            if (travel < 4) onClick(latest.x0, width);
            setBox(null);
          },
        );
      },
    },
  };
}
