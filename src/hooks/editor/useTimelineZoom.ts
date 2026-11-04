import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { followScroll, maxZoom, zoomAround } from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";

const WHEEL_SPEED = 0.01;
const KEY_STEP = 1.5;

type Gesture = Event & { scale: number; clientX: number };

export function useTimelineZoom(
  lengthMs: number,
  clock: Clock,
  isPlaying: boolean,
  playheadMs: (seconds: number) => number,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [wanted, setWanted] = useState(1);
  const zoom = Math.min(wanted, maxZoom(lengthMs));
  const latest = useRef({ zoom, lengthMs, playheadMs });
  const scrollTo = useRef<number | null>(null);

  useLayoutEffect(() => {
    latest.current = { zoom, lengthMs, playheadMs };
    const viewport = viewportRef.current;
    if (viewport && scrollTo.current !== null) {
      viewport.scrollLeft = scrollTo.current;
      scrollTo.current = null;
    }
  });

  function zoomBy(factor: number, anchorPx?: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = zoomAround(
      latest.current.zoom,
      factor,
      anchorPx ?? viewport.clientWidth / 2,
      viewport.scrollLeft,
      latest.current.lengthMs,
    );
    scrollTo.current = next.scrollPx;
    latest.current = { ...latest.current, zoom: next.zoom };
    setWanted(next.zoom);
  }
  const zoomAt = useRef(zoomBy);
  useLayoutEffect(() => {
    zoomAt.current = zoomBy;
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let pinched = 1;
    let isPinching = false;
    const anchor = (clientX: number) =>
      clientX - viewport.getBoundingClientRect().left;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isPinching) return;
      event.preventDefault();
      zoomAt.current(
        Math.exp(-event.deltaY * WHEEL_SPEED),
        anchor(event.clientX),
      );
    };
    const onPinchStart = (event: Event) => {
      event.preventDefault();
      isPinching = true;
      pinched = 1;
    };
    const onPinch = (event: Event) => {
      const { scale, clientX } = event as Gesture;
      event.preventDefault();
      zoomAt.current(scale / pinched, anchor(clientX));
      pinched = scale;
    };
    const onPinchEnd = () => {
      isPinching = false;
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", onPinchStart);
    viewport.addEventListener("gesturechange", onPinch);
    viewport.addEventListener("gestureend", onPinchEnd);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onPinchStart);
      viewport.removeEventListener("gesturechange", onPinch);
      viewport.removeEventListener("gestureend", onPinchEnd);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!isPlaying || zoom === 1 || !viewport) return;
    return clock.subscribe(() => {
      const playheadPx =
        (latest.current.playheadMs(clock.seconds()) / lengthMs) *
        viewport.scrollWidth;
      viewport.scrollLeft = followScroll(
        playheadPx,
        viewport.scrollLeft,
        viewport.clientWidth,
      );
    });
  }, [isPlaying, zoom, clock, lengthMs]);

  const playheadAnchor = () => {
    const viewport = viewportRef.current;
    if (!viewport || lengthMs <= 0) return undefined;
    const playheadPx =
      (playheadMs(clock.seconds()) / lengthMs) * viewport.scrollWidth;
    const x = playheadPx - viewport.scrollLeft;
    return x >= 0 && x <= viewport.clientWidth ? x : undefined;
  };

  return {
    viewportRef,
    zoom,
    zoomIn: () => zoomBy(KEY_STEP, playheadAnchor()),
    zoomOut: () => zoomBy(1 / KEY_STEP, playheadAnchor()),
    fit: () => zoomBy(1 / latest.current.zoom, 0),
  };
}

export type TimelineZoom = ReturnType<typeof useTimelineZoom>;
