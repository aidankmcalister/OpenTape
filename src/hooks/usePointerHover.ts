import { useEffect, useState } from "react";
import type { Point } from "@/lib/geometry";

/** What counts as a hover target: anything clickable, and anything named with `data-hover`. */
const TARGET = "button, a, [role^='menuitem'], [data-hover]";

/**
 * For windows that get no mouse moves of their own (the bar, preview and picker), so CSS
 * `:hover` never fires and Rust reports the pointer instead. Marks the element under `pointer`
 * with `data-hovered`, which every `hover:` style also matches (see index.css), and returns its
 * `data-hover` name, for things like tooltips that need to know.
 */
export function usePointerHover(pointer: Point | null): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const element = pointer
      ? document
          .elementFromPoint(pointer.x, pointer.y)
          ?.closest<HTMLElement>(TARGET)
      : null;
    element?.setAttribute("data-hovered", "");
    // What's under the pointer is only known after the DOM is drawn, so an effect sets it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(
      element?.closest<HTMLElement>("[data-hover]")?.dataset.hover ?? null,
    );
    return () => element?.removeAttribute("data-hovered");
  }, [pointer]);

  return name;
}
