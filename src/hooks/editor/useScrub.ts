import type { PointerEvent } from "react";
import { msAtX } from "@/lib/editor/timeline";

/** Press or drag on an element to seek along it. Spread the result onto the element the time runs across. */
export function useScrub(durationMs: number, seek: (ms: number) => void) {
  function seekTo(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    seek(msAtX(event.clientX - bounds.left, bounds.width, durationMs));
  }

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // Keeps the moves coming to this element even when the pointer leaves it mid-drag.
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
