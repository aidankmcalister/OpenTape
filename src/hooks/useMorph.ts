import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Animation } from "@/lib/bindings";
import type { Size } from "@/lib/geometry";
import { EASE } from "@/lib/time";

const MORPH: Animation = { durationMs: 400, ease: [...EASE] };

export function useMorph<Key extends string>(
  active: Key,
  onShape?: (size: Size, animation: Animation | null) => void,
  edge = 2,
  isInstant = false,
) {
  const layers = useRef(new Map<Key, HTMLElement>());
  const shaped = useRef<Size | null>(null);
  const shapeListener = useRef(onShape);
  const instant = useRef(isInstant);
  const [pillSize, setPillSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    shapeListener.current = onShape;
    instant.current = isInstant;
  });

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
      const width = (element: HTMLElement) =>
        parseFloat(getComputedStyle(element).width) || element.offsetWidth;
      const settling = [
        ...layer.querySelectorAll<HTMLElement>("[data-morph-width]"),
      ].reduce(
        (sum, inner) => sum + Number(inner.dataset.morphWidth) - width(inner),
        0,
      );
      const next = {
        width: Math.round(width(layer) + settling) + edge,
        height: layer.offsetHeight + edge,
      };
      const last = shaped.current;
      if (last?.width === next.width && last.height === next.height) return;
      shaped.current = next;
      setPillSize(next);
      const animates = last && !instant.current;
      shapeListener.current?.(next, animates ? morphAnimation() : null);
    };
    reshape();
    const observer = new ResizeObserver(reshape);
    observer.observe(layer);
    const settles = new MutationObserver(() => flushSync(reshape));
    settles.observe(layer, {
      subtree: true,
      attributeFilter: ["data-morph-width"],
    });
    return () => {
      observer.disconnect();
      settles.disconnect();
    };
  }, [active, edge]);

  const { durationMs, ease } = morphAnimation();
  return {
    pillStyle: pillSize
      ? {
          ...pillSize,
          transition: isInstant
            ? "opacity 200ms ease-out"
            : `width ${durationMs}ms cubic-bezier(${ease.join(",")}), opacity 200ms ease-out`,
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

export function useReflow(key: string, isPaused: boolean) {
  const [shownKey, setShownKey] = useState(key);
  const [isReflowing, setIsReflowing] = useState(false);
  if (key !== shownKey) {
    setShownKey(key);
    setIsReflowing(!isPaused);
  }
  if (isPaused && isReflowing) setIsReflowing(false);
  useEffect(() => {
    if (!isReflowing) return;
    const timer = setTimeout(() => setIsReflowing(false), MORPH.durationMs);
    return () => clearTimeout(timer);
  }, [isReflowing, shownKey]);
  return isReflowing;
}
