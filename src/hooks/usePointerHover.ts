import { useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geometry";

const TARGET = "button, a, [role^='menuitem'], [data-hover]";

export function usePointerHover() {
  const pointer = useRef<Point | null>(null);
  const marked = useRef<HTMLElement | null>(null);
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  function mark() {
    const at = pointer.current;
    const element = at
      ? (document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>(TARGET) ??
        null)
      : null;
    if (element === marked.current) return;
    marked.current?.removeAttribute("data-hovered");
    element?.setAttribute("data-hovered", "");
    marked.current = element;
    setHoveredName(
      element?.closest<HTMLElement>("[data-hover]")?.dataset.hover ?? null,
    );
  }

  useLayoutEffect(mark);
  useLayoutEffect(
    () => () => {
      marked.current?.removeAttribute("data-hovered");
      marked.current = null;
    },
    [],
  );

  return {
    hoveredName,
    setPointer: (next: Point | null) => {
      pointer.current = next;
      mark();
    },
  };
}

export function followPointer(
  onMove: (moved: globalThis.PointerEvent) => void,
  onEnd?: (ended: globalThis.PointerEvent) => void,
) {
  const end = (ended: globalThis.PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onEnd?.(ended);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
