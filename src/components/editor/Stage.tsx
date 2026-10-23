import type { ComponentProps, ReactNode } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  fillCss,
  frameLayout,
  zoomAt,
  type Look,
  type Region,
} from "@/lib/editor/edits";
import type { Clock } from "@/lib/time";
import Island from "./Island";

export default function Stage({
  look,
  ratio,
  clock,
  regions,
  ...props
}: ComponentProps<"video"> & {
  look: Look;
  ratio: number;
  clock: Clock;
  regions: Region[];
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, radius, shadow } = frameLayout(look, size, ratio);
  return (
    <Island className="min-h-0 flex-1 bg-canvas">
      <div ref={ref} className="grid size-full place-items-center">
        <div
          className="grid place-items-center rounded-lg shadow-stage"
          style={{ ...frame, background: fillCss(look.fill) }}
        >
          <div
            className="overflow-hidden"
            style={{
              ...recording,
              borderRadius: radius,
              boxShadow: `0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`,
            }}
          >
            <Zoom clock={clock} regions={regions}>
              <video className="size-full object-cover" {...props} />
            </Zoom>
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
  return (
    <div className="size-full" style={{ transform: `scale(${scale})` }}>
      {children}
    </div>
  );
}
