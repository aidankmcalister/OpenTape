import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@/lib/geometry";

/** What counts as a hover target: anything clickable, and anything named with `data-hover`. */
const TARGET = "button, a, [role^='menuitem'], [data-hover]";

type PointerHover = {
  /** The `data-hover` name of what's under the pointer, for things like tooltips. */
  hovered: string | null;
  /** Hears each pointer Rust reports, in page coordinates, or null when it's elsewhere. */
  point: (pointer: Point | null) => void;
};

/**
 * For windows that get no mouse moves of their own (the preview and picker), so CSS `:hover`
 * never fires and Rust reports the pointer instead. Marks the element under it with
 * `data-hovered`, which every `hover:` style also matches (see index.css).
 *
 * The pointer streams in many times a second, so it's kept out of React state: the page redraws
 * only when the hovered name changes, not on every move.
 */
export function usePointerHover(): PointerHover {
  const pointer = useRef<Point | null>(null);
  const marked = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const mark = useCallback(() => {
    const at = pointer.current;
    const element = at
      ? (document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>(TARGET) ??
        null)
      : null;
    if (element === marked.current) return;
    marked.current?.removeAttribute("data-hovered");
    element?.setAttribute("data-hovered", "");
    marked.current = element;
    setHovered(
      element?.closest<HTMLElement>("[data-hover]")?.dataset.hover ?? null,
    );
  }, []);

  // A redraw can put something new under a pointer that hasn't moved.
  useLayoutEffect(mark);
  useLayoutEffect(
    () => () => {
      marked.current?.removeAttribute("data-hovered");
      marked.current = null;
    },
    [],
  );

  const point = useCallback(
    (next: Point | null) => {
      pointer.current = next;
      mark();
    },
    [mark],
  );

  return { hovered, point };
}
