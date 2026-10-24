import { useState, type PointerEvent } from "react";
import { msAtX } from "@/lib/editor/timeline";

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
