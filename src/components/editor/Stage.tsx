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
import { type RingEvent, ringsAt } from "@/lib/editor/cursor";
import { focusAt, focusBox, zoomAt } from "@/lib/editor/zoom";
import type { Point } from "@/lib/geometry";
import {
  blockValue,
  laneKinds,
  outputAt,
  REGIONS,
  winnerAt,
  type Region,
} from "@/lib/editor/regions";
import type { Clock } from "@/lib/time";
import Island from "./Island";
import { hueOf, REGION_ICONS } from "./timeline/kinds";

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
                style={{
                  left: video.x,
                  top: video.y,
                  width: video.width,
                  height: video.height,
                }}
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
  const shown: ReturnType<typeof ringsAt> = JSON.parse(
    useClockValue(clock, (seconds) =>
      JSON.stringify(ringsAt(rings, seconds * 1000)),
    ),
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
  const ids = useClockValue(clock, (seconds) =>
    laneKinds(regions)
      .map((kind) => winnerAt(regions, kind, seconds * 1000)?.id)
      .filter((id) => id !== undefined)
      .join(","),
  );
  const winners = ids
    .split(",")
    .map((id) => regions.find((region) => String(region.id) === id))
    .filter((region) => region !== undefined);
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
