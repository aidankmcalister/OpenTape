import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { keptClips, keptTime, trimClip } from "@/lib/editor/clips";
import {
  dragRegions,
  MIN_REGION_MS,
  type RegionDrag,
} from "@/lib/editor/regions";
import { MIN_BLOCK_PX } from "@/lib/editor/timeline";
import { editClips, editRegions, type Project } from "@/lib/editor/project";
import type { Edits } from "./useProject";

type Stretching = {
  track: "region" | "clip";
  id: number;
  edge: RegionDrag;
  from: { startMs: number; endMs: number };
};

export function useTimelineDrag(edits: Edits, durationMs: number) {
  const latest = useRef(edits);
  useLayoutEffect(() => {
    latest.current = edits;
  });
  const [stretching, setStretching] = useState<Stretching | null>(null);
  const clips = keptClips(edits.project.clips, durationMs);
  const now =
    stretching?.track === "clip"
      ? clips.find(({ id }) => id === stretching.id)
      : edits.shown.find(({ id }) => id === stretching?.id);

  const dragProps = (
    select: (event: PointerEvent<HTMLElement>) => void,
    edit: (project: Project, deltaMs: number, width: number) => Project,
    stretch?: Stretching,
    onClick?: () => void,
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const track = event.currentTarget.closest("[data-track]");
      if (!track?.clientWidth) return;
      select(event);
      const { clientX: fromX, clientY: fromY } = event;
      const width = track.clientWidth;
      const { lengthMs } = latest.current.time;
      let hasMoved = false;
      const move = (moved: globalThis.PointerEvent) => {
        const travel =
          Math.abs(moved.clientX - fromX) + Math.abs(moved.clientY - fromY);
        if (!hasMoved && travel < 3) return;
        if (!hasMoved) {
          latest.current.closeEditor();
          setStretching(stretch ?? null);
          hasMoved = true;
        }
        const deltaMs = ((moved.clientX - fromX) / width) * lengthMs;
        latest.current.preview((project) => edit(project, deltaMs, width));
      };
      const end = (ended: globalThis.PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        setStretching(null);
        if (hasMoved) latest.current.commit();
        else if (ended.type === "pointerup" && !ended.shiftKey) onClick?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
  });

  return {
    stretch: stretching && now ? { ...stretching, now } : null,
    region: (id: number, edge: RegionDrag) => {
      const from = edits.shown.find((region) => region.id === id);
      const ids =
        edge === "move" && edits.selectedIds.includes(id)
          ? edits.selectedIds
          : [id];
      return dragProps(
        (event) => edits.pick(id, event.shiftKey),
        (project, deltaMs, width) =>
          editRegions(project, (regions) => {
            const time = keptTime(project.clips, durationMs);
            return time.edit(regions, (shown, lengthMs) =>
              dragRegions(
                shown,
                ids,
                edge,
                deltaMs,
                lengthMs,
                Math.max(MIN_REGION_MS, (MIN_BLOCK_PX / width) * lengthMs),
              ),
            );
          }),
        from && { track: "region", id, edge, from },
        () => {
          edits.select([id]);
          edits.openEditor(id);
        },
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
