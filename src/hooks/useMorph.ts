import { useLayoutEffect, useRef, useState } from "react";
import type { Animation } from "@/lib/bindings/Animation";
import type { Size } from "@/lib/geometry";

/** A pill's 1px border sits outside the measured layer. */
const BORDER = 1;

/** The one place the morph's timing lives: pills use it, and Rust's glass follows it. */
const MORPH: Animation = { durationMs: 400, ease: [0.32, 0.72, 0, 1] };

/**
 * Morphs a pill between layers of different widths, like the record bar's states.
 * Every layer stays mounted at its natural size, and the pill animates to the active one's.
 * `onShape` hears each new size, with the animation to follow, or null for the first.
 */
export function useMorph<Key extends string>(
  active: Key,
  onShape?: (size: Size, animation: Animation | null) => void,
) {
  const layers = useRef(new Map<Key, HTMLElement>());
  const hasShaped = useRef(false);
  const shapeListener = useRef(onShape);
  const [pill, setPill] = useState<Size | null>(null);
  useLayoutEffect(() => {
    shapeListener.current = onShape;
  });

  useLayoutEffect(() => {
    const layer = layers.current.get(active);
    if (!layer) return;
    const reshape = () => {
      const next = {
        width: layer.offsetWidth + BORDER * 2,
        height: layer.offsetHeight + BORDER * 2,
      };
      setPill(next);
      shapeListener.current?.(next, hasShaped.current ? morph() : null);
      hasShaped.current = true;
    };
    reshape();
    const observer = new ResizeObserver(reshape);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [active]);

  return {
    pillStyle: pill ? { ...pill, transition: widthTransition() } : undefined,
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

function morph(): Animation {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  return reduceMotion ? { ...MORPH, durationMs: 0 } : MORPH;
}

function widthTransition(): string {
  const { durationMs, ease } = morph();
  return `width ${durationMs}ms cubic-bezier(${ease.join(",")})`;
}
