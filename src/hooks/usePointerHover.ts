import { useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geometry";

/** What counts as a hover target: anything clickable, and anything named with `data-hover`. */
const TARGET = "button, a, [role^='menuitem'], [data-hover]";

/**
 * Hover for the preview and picker, which get no mouse moves, so CSS `:hover` never fires. Rust
 * reports the pointer instead, and the element under it gets `data-hovered`, which every `hover:`
 * style also matches (see index.css). The pointer stays out of React state, so the page redraws
 * only when the hovered name changes.
 */
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
    /** The `data-hover` name of what's under the pointer, for things like tooltips. */
    hoveredName,
    /** Hears each pointer Rust reports, in page coordinates, or null when it's elsewhere. */
    setPointer: (next: Point | null) => {
      pointer.current = next;
      mark();
    },
  };
}
