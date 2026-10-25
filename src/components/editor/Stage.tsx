import { type ComponentProps, type ReactNode } from "react";
import { Move } from "lucide-react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import { fillCss, frameLayout, type Appearance } from "@/lib/editor/appearance";
import { type RingEvent, ringsAt } from "@/lib/editor/cursor";
import { focusAt, focusBox, focusBoxStyle, zoomAt } from "@/lib/editor/zoom";
import { type Point, rectStyle } from "@/lib/geometry";
import {
  blockValue,
  outputAt,
  REGIONS,
  winnersAt,
  type Region,
} from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import Island from "./Island";
import { hueOf, REGION_ICONS } from "./timeline/kinds";
import { followPointer } from "@/hooks/usePointerHover";

export default function Stage({
  appearance,
  ratio,
  clock,
  regions,
  rings,
  focus,
  ...props
}: ComponentProps<"video"> & {
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
  rings: RingEvent[];
  focus: Focusing | null;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, radius, shadow, border, video, scale } =
    frameLayout(appearance, size, ratio);

  return (
    <Island className="relative min-h-0 flex-1 bg-canvas dot-grid">
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
                style={rectStyle(video)}
                {...props}
              />
              <ClickRings
                clock={clock}
                rings={rings}
                video={video}
                scale={scale}
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
      <InEffect clock={clock} regions={regions} />
    </Island>
  );
}

function ClickRings({
  clock,
  rings,
  video,
  scale,
}: {
  clock: Clock;
  rings: RingEvent[];
  video: { x: number; y: number; width: number; height: number };
  scale: number;
}) {
  const shown = useClockValue(clock, (seconds) =>
    ringsAt(rings, seconds * 1000),
  );
  return shown.flatMap((ring, at) =>
    ring.circles.map((circle, index) => {
      const side = circle.radius * 2 * scale;
      const line = Math.max(2, ring.size * 0.08) * scale;
      return (
        <div
          key={`${at}-${index}`}
          className="pointer-events-none absolute -translate-1/2 rounded-full"
          style={{
            left: video.x + ring.x * video.width,
            top: video.y + ring.y * video.height,
            width: side,
            height: side,
            opacity: circle.alpha,
            background: circle.isFilled ? ring.color : undefined,
            boxShadow: circle.isFilled
              ? undefined
              : `inset 0 0 0 ${line}px ${ring.color}`,
          }}
        />
      );
    }),
  );
}

function InEffect({ clock, regions }: { clock: Clock; regions: Region[] }) {
  const winners = useClockValue(clock, (seconds) =>
    winnersAt(regions, seconds * 1000),
  );
  return (
    <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1">
      {winners.map((region) => {
        const Icon = REGION_ICONS[region.kind];
        return (
          <span
            key={region.id}
            className="flex h-6 items-center gap-1.5 rounded-md bg-hue-fill px-2 text-label font-semibold text-hue-foreground"
            style={hueOf(region.kind)}
          >
            <Icon className="size-4" />
            {REGIONS[region.kind].label}
            <span className="font-mono font-medium">{blockValue(region)}</span>
          </span>
        );
      })}
    </div>
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
  const box = focusBox(zoom);
  return (
    <div data-keeps-editor className="absolute inset-0">
      <div
        className="absolute grid cursor-grab place-items-center rounded-sm border-2 border-highlight bg-highlight/16 active:cursor-grabbing"
        style={focusBoxStyle(zoom)}
        onPointerDown={(event) => {
          const { width, height } =
            event.currentTarget.parentElement!.getBoundingClientRect();
          const { clientX: x, clientY: y } = event;
          followPointer(
            (moved) =>
              onMove(
                focusAt(
                  {
                    x: box.x + (moved.clientX - x) / width,
                    y: box.y + (moved.clientY - y) / height,
                  },
                  zoom.amount,
                ),
              ),
            onDone,
          );
        }}
      >
        <div className="grid size-6 place-items-center rounded-full bg-highlight text-primary-foreground">
          <Move className="size-3.5" />
        </div>
      </div>
    </div>
  );
}
