import { useLayoutEffect, useRef, useState } from "react";
import { shapeBar } from "@/lib/app";
import type { Size } from "@/lib/geometry";

/** The pill's 1px border sits outside the measured layer. */
const BORDER = 1;

/**
 * Morphs the bar between layers of different widths. The pill animates in CSS while Rust
 * animates the glass behind it on the same curve; the window itself never resizes, so the
 * content never stretches.
 */
export function useBarMorph<Key extends string>(active: Key) {
  const layers = useRef(new Map<Key, HTMLElement>());
  const hasShaped = useRef(false);
  const [pill, setPill] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const layer = layers.current.get(active);
    if (!layer) return;
    const reshape = () => {
      const next = {
        width: layer.offsetWidth + BORDER * 2,
        height: layer.offsetHeight + BORDER * 2,
      };
      setPill(next);
      void shapeBar(next.width, next.height, hasShaped.current);
      hasShaped.current = true;
    };
    reshape();
    const observer = new ResizeObserver(reshape);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [active]);

  return {
    pillStyle: pill ?? undefined,
    layerProps: (key: Key) => ({
      ref: (element: HTMLElement | null) => {
        if (element) layers.current.set(key, element);
        else layers.current.delete(key);
      },
      inert: key !== active,
      "data-active": key === active,
    }),
  };
}
