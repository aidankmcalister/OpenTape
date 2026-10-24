import { useRef, type PointerEvent } from "react";
import { trimClip } from "@/lib/editor/clips";
import { dragRegion, type RegionDrag } from "@/lib/editor/regions";
import { editClips, editRegions, type Project } from "@/lib/editor/project";
import type { Edits } from "./useProject";

export function useTimelineDrag(edits: Edits, durationMs: number) {
  const drag = useRef<{ fromX: number; width: number } | null>(null);

  const dragProps = (
    select: () => void,
    edit: (project: Project, deltaMs: number) => Project,
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const track = event.currentTarget.closest("[data-track]");
      if (!track?.clientWidth) return;
      select();
      drag.current = { fromX: event.clientX, width: track.clientWidth };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId))
        return;
      const deltaMs =
        ((event.clientX - current.fromX) / current.width) * durationMs;
      edits.preview((project) => edit(project, deltaMs));
    },
    onPointerUp: () => {
      if (!drag.current) return;
      edits.commit();
      drag.current = null;
    },
  });

  return {
    region: (id: number, edge: RegionDrag) =>
      dragProps(
        () => edits.select(id),
        (project, deltaMs) =>
          editRegions(project, (regions) =>
            dragRegion(regions, id, edge, deltaMs, durationMs),
          ),
      ),
    clip: (id: number, edge: "start" | "end") =>
      dragProps(
        () => edits.selectClip(id),
        (project, deltaMs) =>
          editClips(project, (clips) =>
            trimClip(clips, id, edge, deltaMs, durationMs),
          ),
      ),
  };
}

export type TimelineDrag = ReturnType<typeof useTimelineDrag>;
