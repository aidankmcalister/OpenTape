import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { RegionDrag } from "@/lib/editor/regions";
import type { Edits } from "./useProject";
import { followPointer } from "@/hooks/usePointerHover";

type Stretching = {
  track: "region" | "clip";
  id: number;
  edge: RegionDrag;
};

export function useTimelineDrag(edits: Edits) {
  const latest = useRef(edits);
  useLayoutEffect(() => {
    latest.current = edits;
  });
  const [stretching, setStretching] = useState<Stretching | null>(null);

  const dragProps = (
    select: (event: PointerEvent<HTMLElement>) => void,
    onDrag: (deltaMs: number) => void,
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
      followPointer(
        (moved) => {
          const travel =
            Math.abs(moved.clientX - fromX) + Math.abs(moved.clientY - fromY);
          if (!hasMoved && travel < 3) return;
          if (!hasMoved) {
            latest.current.closeEditor();
            setStretching(stretch ?? null);
            hasMoved = true;
          }
          const deltaMs = ((moved.clientX - fromX) / width) * lengthMs;
          onDrag(deltaMs);
        },
        (ended) => {
          setStretching(null);
          if (hasMoved) latest.current.commit();
          else if (ended.type === "pointerup" && !ended.shiftKey) onClick?.();
        },
      );
    },
  });

  return {
    stretch: stretching,
    region: (id: number, edge: RegionDrag) => {
      const ids =
        edge === "move" && edits.selectedIds.includes(id)
          ? edits.selectedIds
          : [id];
      return dragProps(
        (event) => edits.pick(id, event.shiftKey),
        (deltaMs) => latest.current.retime(ids, edge, deltaMs, true),
        { track: "region", id, edge },
        () => edits.openEditor(id),
      );
    },
    clip: (id: number, edge: "start" | "end") =>
      dragProps(
        () => edits.selectClip(id),
        (deltaMs) => latest.current.trim(id, edge, deltaMs, true),
        { track: "clip", id, edge },
      ),
  };
}

export type TimelineDrag = ReturnType<typeof useTimelineDrag>;
