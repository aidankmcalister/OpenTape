import type { PointerEvent } from "react";
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
