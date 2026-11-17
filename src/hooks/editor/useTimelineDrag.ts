import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { RegionDrag } from "@/lib/editor/regions";
import { dragScrollPx } from "@/lib/editor/timeline";
import type { Edits } from "./useProject";
import { followPointer } from "@/hooks/usePointerHover";

type Stretching = {
  track: "region" | "clip";
  id: number;
  /** Every block the drag moves or resizes. */
  ids: number[];
  edge: RegionDrag;
  lengthMs: number;
};

/** How near an edge, in px, a dragged block must come to catch it. */
const SNAP_PX = 6;

export function useTimelineDrag(edits: Edits) {
  const latest = useRef(edits);
  useLayoutEffect(() => {
    latest.current = edits;
  });
  const [stretching, setStretching] = useState<Stretching | null>(null);

  const dragProps = (
    select: (event: PointerEvent<HTMLElement>) => void,
    onDrag: (deltaMs: number, withinMs: number) => void,
    stretch?: Omit<Stretching, "lengthMs">,
    onClick?: () => void,
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const track = event.currentTarget.closest("[data-track]");
      const view = track?.parentElement;
      if (!track?.clientWidth || !view) return;
      select(event);
      const { clientX: fromX, clientY: fromY } = event;
      const fromScroll = view.scrollLeft;
      const width = track.clientWidth;
      const { lengthMs } = latest.current.time;
      let hasMoved = false;
      let atX = fromX;
      let frame = 0;
      const update = () =>
        onDrag(
          ((atX - fromX + view.scrollLeft - fromScroll) / width) * lengthMs,
          (SNAP_PX / width) * lengthMs,
        );
      // Near the view's edge, the timeline scrolls under the pointer until it moves away.
      const scroll = () => {
        const { left, right } = view.getBoundingClientRect();
        const before = view.scrollLeft;
        view.scrollLeft += dragScrollPx(atX, left, right);
        frame = view.scrollLeft === before ? 0 : requestAnimationFrame(scroll);
        if (frame) update();
      };
      followPointer(
        (moved) => {
          const travel =
            Math.abs(moved.clientX - fromX) + Math.abs(moved.clientY - fromY);
          if (!hasMoved && travel < 3) return;
          if (!hasMoved) {
            latest.current.closeEditor();
            setStretching(stretch ? { ...stretch, lengthMs } : null);
            hasMoved = true;
          }
          atX = moved.clientX;
          update();
          if (!frame) scroll();
        },
        (ended) => {
          cancelAnimationFrame(frame);
          setStretching(null);
          if (hasMoved) latest.current.commit();
          else if (
            ended.type === "pointerup" &&
            !ended.shiftKey &&
            !ended.metaKey
          )
            onClick?.();
        },
      );
    },
  });

  return {
    stretch: stretching,
    /** `members`: a keystroke run, which selects and moves all its blocks and opens no editor. */
    region: (id: number, edge: RegionDrag, members?: number[]) => {
      const ids =
        edge === "move" && edits.selectedIds.includes(id)
          ? edits.selectedIds
          : (members ?? [id]);
      return dragProps(
        (event) => edits.pick(members ?? [id], event.shiftKey || event.metaKey),
        (deltaMs, withinMs) =>
          latest.current.retime(ids, edge, deltaMs, {
            isPreview: true,
            withinMs,
          }),
        { track: "region", id, ids, edge },
        members ? undefined : () => edits.openEditor(id),
      );
    },
    clip: (id: number, edge: "start" | "end") =>
      dragProps(
        () => edits.selectClip(id),
        (deltaMs) => latest.current.trim(id, edge, deltaMs, true),
        { track: "clip", id, ids: [id], edge },
      ),
  };
}

export type TimelineDrag = ReturnType<typeof useTimelineDrag>;
