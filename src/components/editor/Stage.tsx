import {
  useRef,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Move } from "lucide-react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import { fillCss, frameLayout, type Appearance } from "@/lib/editor/appearance";
import { focusAt, focusBox, zoomAt } from "@/lib/editor/zoom";
import type { Point } from "@/lib/geometry";
import { outputAt, type Region } from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import Island from "./Island";

export default function Stage({
  appearance,
  ratio,
  clock,
  regions,
  focus,
  ...props
}: ComponentProps<"video"> & {
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
  focus: Focusing | null;
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
            <Zoom clock={clock} regions={focus ? [] : regions}>
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
            {focus ? <FocusBox {...focus} /> : null}
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
  const at = (seconds: number) =>
    zoomAt(regions, outputAt(regions, seconds * 1000));
  const scale = useClockValue(clock, (seconds) => at(seconds).scale);
  const origin = useClockValue(clock, (seconds) => {
    const { center } = at(seconds);
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

type Focusing = {
  zoom: Region;
  onMove: (center: Point) => void;
  onDone: () => void;
};

function FocusBox({ zoom, onMove, onDone }: Focusing) {
  const drag = useRef<{ x: number; y: number; width: number; height: number }>(
    null,
  );
  const box = focusBox(zoom);
  const move = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (!from || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    onMove(
      focusAt(
        {
          x: box.x + (event.clientX - from.x) / from.width,
          y: box.y + (event.clientY - from.y) / from.height,
        },
        zoom.amount,
      ),
    );
    drag.current = { ...from, x: event.clientX, y: event.clientY };
  };
  return (
    <div data-keeps-editor className="absolute inset-0">
      <div
        className="absolute grid cursor-grab place-items-center rounded-sm border-2 border-highlight bg-highlight/16 active:cursor-grabbing"
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.size * 100}%`,
          height: `${box.size * 100}%`,
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const area =
            event.currentTarget.parentElement!.getBoundingClientRect();
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            width: area.width,
            height: area.height,
          };
        }}
        onPointerMove={move}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onDone();
        }}
      >
        <div className="grid size-6 place-items-center rounded-full bg-highlight text-primary-foreground">
          <Move className="size-3.5" />
        </div>
      </div>
    </div>
  );
}
