import { useLayoutEffect, useRef, useState } from "react";
import type { Animation } from "@/lib/bindings";
import type { Size } from "@/lib/geometry";

const MORPH: Animation = { durationMs: 400, ease: [0.32, 0.72, 0, 1] };

export function useMorph<Key extends string>(
  active: Key,
  onShape?: (size: Size, animation: Animation | null) => void,
) {
  const layers = useRef(new Map<Key, HTMLElement>());
  const shaped = useRef<Size | null>(null);
  const shapeListener = useRef(onShape);
  const [pillSize, setPillSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    shapeListener.current = onShape;
  });

  // A remount, like StrictMode's, starts over so its first shape isn't animated.
  useLayoutEffect(
    () => () => {
      shaped.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const layer = layers.current.get(active);
    if (!layer) return;
    const reshape = () => {
      // The pill's 1px border sits outside the measured layer.
      const next = {
        width: layer.offsetWidth + 2,
        height: layer.offsetHeight + 2,
      };
      const last = shaped.current;
      if (last?.width === next.width && last.height === next.height) return;
      shaped.current = next;
      setPillSize(next);
      shapeListener.current?.(next, last ? morphAnimation() : null);
    };
    reshape();
    const observer = new ResizeObserver(reshape);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [active]);

  const { durationMs, ease } = morphAnimation();
  return {
    pillStyle: pillSize
      ? {
          ...pillSize,
          // Opacity here, not on a wrapper: fading a wrapper cuts the backdrop blur off until the fade ends.
          transition: `width ${durationMs}ms cubic-bezier(${ease.join(",")}), opacity 200ms ease-out`,
        }
      : undefined,
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

function morphAnimation(): Animation {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  return reduceMotion ? { ...MORPH, durationMs: 0 } : MORPH;
}
