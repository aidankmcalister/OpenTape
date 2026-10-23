import { useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geometry";

const TARGET = "button, a, [role^='menuitem'], [data-hover]";

// Some windows get no mouse moves, so CSS :hover never fires; Rust reports the pointer and the element under it gets data-hovered (see index.css).
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

  // A redraw can put something new under a pointer that hasn't moved.
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
