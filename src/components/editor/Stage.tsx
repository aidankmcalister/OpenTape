import { type ComponentProps, type ReactNode, useMemo } from "react";
import { Move } from "lucide-react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  type Appearance,
  type CursorSettings,
  fillCss,
  frameLayout,
} from "@/lib/editor/appearance";
import {
  DOT_POINTS,
  cursorPath,
  cursorPictures,
  cursorUnit,
  plainOr,
  type CursorTrack,
  type RingEvent,
  ringsAt,
} from "@/lib/editor/cursor";
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
  cursor,
  durationMs,
  focus,
  ...props
}: ComponentProps<"video"> & {
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
  rings: RingEvent[];
  cursor: CursorTrack;
  durationMs: number;
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
          <div className="relative" style={recording}>
            <div
              className="relative size-full overflow-hidden"
              style={{
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
            <div className="pointer-events-none absolute inset-0">
              <Cursor
                clock={clock}
                track={cursor}
                settings={appearance.cursor}
                durationMs={durationMs}
                video={video}
                size={recording}
                regions={focus ? [] : regions}
              />
            </div>
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

function Cursor({
  clock,
  track,
  settings,
  durationMs,
  video,
  size,
  regions,
}: {
  clock: Clock;
  track: CursorTrack;
  settings: CursorSettings;
  durationMs: number;
  video: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  regions: Region[];
}) {
  const spotAt = useMemo(
    () => cursorPath(track, settings, durationMs),
    [track, settings, durationMs],
  );
  const pictures = useMemo(
    () => cursorPictures(track.images, plainOr(settings).style),
    [track.images, settings],
  );
  const seen = useClockValue(clock, (seconds) => {
    const spot = spotAt(seconds * 1000);
    if (!spot) return null;
    const { scale, center } = zoomAt(
      regions,
      outputAt(regions, seconds * 1000),
    );
    const zoomed = (at: number, share: number, length: number) =>
      share * length + (at - share * length) * scale;
    const tip = {
      x: zoomed(video.x + spot.x * video.width, center.x, size.width),
      y: zoomed(video.y + spot.y * video.height, center.y, size.height),
    };
    const isInside =
      tip.x >= 0 && tip.x <= size.width && tip.y >= 0 && tip.y <= size.height;
    return isInside ? { spot, tip, scale } : null;
  });
  if (!seen || seen.spot.alpha === 0) return null;
  const { spot, tip } = seen;
  const px =
    cursorUnit(track, settings) * video.width * spot.scale * seen.scale;
  if (plainOr(settings).style === "Dot") {
    const side = DOT_POINTS * px;
    return (
      <div
        className="pointer-events-none absolute rounded-full border-cursor-edge/90 bg-cursor/55"
        style={{
          left: tip.x - side / 2,
          top: tip.y - side / 2,
          width: side,
          height: side,
          borderWidth: side * 0.06,
          opacity: spot.alpha,
        }}
      />
    );
  }
  const image = pictures.find(({ kind }) => kind === spot.kind) ?? pictures[0];
  if (!image) return null;
  return (
    <img
      src={image.src}
      alt=""
      className="pointer-events-none absolute max-w-none"
      style={{
        left: tip.x - image.hotX * px,
        top: tip.y - image.hotY * px,
        width: image.width * px,
        height: image.height * px,
        opacity: spot.alpha,
        rotate: `${spot.angle}deg`,
        transformOrigin: `${image.hotX * px}px ${image.hotY * px}px`,
      }}
    />
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
