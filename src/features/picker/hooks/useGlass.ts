import { useEffect, useLayoutEffect, useRef } from "react";
import { placeOverlayGlass } from "@/features/picker/lib/picker";

/**
 * Puts Rust's frosted glass under the element, following it as it moves, so a see-through pill
 * blurs the apps behind an overlay. A page can only blur its own content.
 */
export function useGlass<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  /** Where the glass was last put, so it's only moved when the element moves. */
  const placed = useRef("");

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { x, y, width, height } = element.getBoundingClientRect();
    const key = [x, y, width, height].map(Math.round).join();
    if (key === placed.current) return;
    placed.current = key;
    void placeOverlayGlass({ x, y, width, height });
  });

  // Hidden on unmount, and forgotten, so a remount puts it back.
  useEffect(
    () => () => {
      placed.current = "";
      void placeOverlayGlass(null);
    },
    [],
  );

  return ref;
}
