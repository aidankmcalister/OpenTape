import { useRef, type PointerEvent } from "react";
import { dragRegion, editRegions, type RegionDrag } from "@/lib/editor/edits";
import type { Edits } from "./useProject";

export function useRegionDrag(edits: Edits, durationMs: number) {
  const drag = useRef<{ fromX: number; width: number } | null>(null);

  return (id: number, edge: RegionDrag) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const track = event.currentTarget.closest("[data-track]");
      if (!track?.clientWidth) return;
      edits.select(id);
      drag.current = { fromX: event.clientX, width: track.clientWidth };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId))
        return;
      const deltaMs =
        ((event.clientX - current.fromX) / current.width) * durationMs;
      edits.preview((project) =>
        editRegions(project, (regions) =>
          dragRegion(regions, id, edge, deltaMs, durationMs),
        ),
      );
    },
    onPointerUp: () => {
      if (!drag.current) return;
      edits.commit();
      drag.current = null;
    },
  });
}
