import { useRef, useState, type PointerEvent } from "react";
import { keptClips, trimClip } from "@/lib/editor/clips";
import { dragRegion, type RegionDrag } from "@/lib/editor/regions";
import { editClips, editRegions, type Project } from "@/lib/editor/project";
import type { Edits } from "./useProject";

type Stretching = {
  track: "region" | "clip";
  id: number;
  edge: "start" | "end";
  from: { startMs: number; endMs: number; row?: number };
};

export function useTimelineDrag(
  edits: Edits,
  durationMs: number,
  rowAt: (clientY: number) => number,
) {
  const drag = useRef<{
    fromX: number;
    fromY: number;
    width: number;
    hasMoved: boolean;
  } | null>(null);
  const [stretching, setStretching] = useState<Stretching | null>(null);
  const clips = keptClips(edits.project.clips, durationMs);
  const now =
    stretching?.track === "clip"
      ? clips.find(({ id }) => id === stretching.id)
      : edits.project.regions.find(({ id }) => id === stretching?.id);

  const dragProps = (
    select: (event: PointerEvent<HTMLElement>) => void,
    edit: (project: Project, deltaMs: number, clientY: number) => Project,
    stretch?: Stretching,
    onClick?: () => void,
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const track = event.currentTarget.closest("[data-track]");
      if (!track?.clientWidth) return;
      select(event);
      setStretching(stretch ?? null);
      drag.current = {
        fromX: event.clientX,
        fromY: event.clientY,
        width: track.clientWidth,
        hasMoved: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId))
        return;
      const travel =
        Math.abs(event.clientX - current.fromX) +
        Math.abs(event.clientY - current.fromY);
      if (travel < 3 && !current.hasMoved) return;
      if (!current.hasMoved) edits.closeEditor();
      current.hasMoved = true;
      const deltaMs =
        ((event.clientX - current.fromX) / current.width) * durationMs;
      edits.preview((project) => edit(project, deltaMs, event.clientY));
    },
    onPointerUp: () => {
      if (!drag.current) return;
      if (drag.current.hasMoved) edits.commit();
      else onClick?.();
      drag.current = null;
      setStretching(null);
    },
  });

  return {
    stretch: stretching && now ? { ...stretching, now } : null,
    region: (id: number, edge: RegionDrag) => {
      const from = edits.project.regions.find((region) => region.id === id);
      return dragProps(
        (event) => edits.pick(id, event.shiftKey),
        (project, deltaMs, clientY) =>
          editRegions(project, (regions) =>
            dragRegion(
              regions,
              id,
              edge,
              deltaMs,
              durationMs,
              edge === "move" ? rowAt(clientY) : undefined,
            ),
          ),
        from && edge !== "move"
          ? { track: "region", id, edge, from }
          : undefined,
        () => edits.openEditor(id),
      );
    },
    clip: (id: number, edge: "start" | "end") => {
      const from = clips.find((clip) => clip.id === id);
      return dragProps(
        () => edits.selectClip(id),
        (project, deltaMs) =>
          editClips(project, (clips) =>
            trimClip(clips, id, edge, deltaMs, durationMs),
          ),
        from && { track: "clip", id, edge, from },
      );
    },
  };
}

export type TimelineDrag = ReturnType<typeof useTimelineDrag>;
