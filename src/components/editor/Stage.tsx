import type { ComponentProps, ReactNode } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  fillCss,
  frameLayout,
  zoomAt,
  type Appearance,
  type Region,
} from "@/lib/editor/edits";
import type { Clock } from "@/lib/time";
import Island from "./Island";

export default function Stage({
  appearance,
  ratio,
  clock,
  regions,
  ...props
}: ComponentProps<"video"> & {
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, radius, shadow, border, video } = frameLayout(
    appearance,
    size,
    ratio,
  );

  return (
    <Island className="min-h-0 flex-1 bg-canvas dot-grid">
      <div ref={ref} className="grid size-full place-items-center">
        <div
          className="grid place-items-center rounded-lg shadow-stage"
          style={{ ...frame, background: fillCss(appearance.fill) }}
        >
          <div
            className="relative overflow-hidden"
            style={{
              ...recording,
              borderRadius: radius,
              boxShadow: `0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`,
            }}
          >
            <Zoom clock={clock} regions={regions}>
              <video
                className="absolute max-w-none object-cover"
                style={{
                  left: video.x,
                  top: video.y,
                  width: video.width,
                  height: video.height,
                }}
                {...props}
              />
            </Zoom>
            {border.color ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  borderRadius: radius,
                  boxShadow: `inset 0 0 0 ${border.width}px ${border.color}`,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Island>
  );
}

function Zoom({
  clock,
  regions,
  children,
}: {
  clock: Clock;
  regions: Region[];
  children: ReactNode;
}) {
  const scale = useClockValue(
    clock,
    (seconds) => zoomAt(regions, seconds * 1000).scale,
  );
  const origin = useClockValue(clock, (seconds) => {
    const { center } = zoomAt(regions, seconds * 1000);
    return `${center.x * 100}% ${center.y * 100}%`;
  });
  return (
    <div
      className="relative size-full"
      style={{ transform: `scale(${scale})`, transformOrigin: origin }}
    >
      {children}
    </div>
  );
}
