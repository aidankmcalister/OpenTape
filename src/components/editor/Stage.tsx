import { type ComponentProps, type ReactNode, useMemo } from "react";
import { Move } from "lucide-react";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/useVideoClock";
import {
  type Appearance,
  type CursorSettings,
  fillCss,
  frameCrop,
  frameLayout,
} from "@/lib/editor/appearance";
import {
  DOT_POINTS,
  cursorPath,
  cursorPictures,
  cursorUnit,
  outsideAlpha,
  nativeOr,
  type CursorTrack,
  type RingEvent,
  ringCircles,
  ringsAt,
  zoomedTip,
} from "@/lib/editor/cursor";
import { focusAt, focusBox, followsCursor, zoomPath } from "@/lib/editor/zoom";
import {
  percentStyle,
  type Point,
  type Rect,
  rectStyle,
  type Size,
} from "@/lib/geometry";
import {
  blockValue,
  blurOf,
  type BoxDrag,
  draggedBox,
  outputAt,
  REGIONS,
  regionAt,
  regionsAt,
  type Region,
} from "@/lib/editor/regions";
import { type Clip, keptClips } from "@/lib/editor/clips";
import type { Clock } from "@/lib/time";
import Island from "./Island";
import { hueOf, REGION_ICONS } from "./timeline/kinds";
import { followPointer } from "@/hooks/usePointerHover";
import { cn } from "@/lib/utils";

export default function Stage({
  fileSrc,
  appearance,
  ratio,
  clock,
  regions,
  clips,
  rings,
  cursor,
  durationMs,
  editing,
  ...props
}: ComponentProps<"video"> & {
  fileSrc: (name: string) => string;
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
  clips: Clip[];
  rings: RingEvent[];
  cursor: CursorTrack;
  durationMs: number;
  editing: Editing | null;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, picture, radius, shadow, border, video, scale } =
    frameLayout(appearance, size, ratio);
  const isFocusing = editing?.region.kind === "zoom";
  const { x: cropX, y: cropY } = frameCrop(appearance, ratio);
  const kept = keptClips(clips, durationMs);
  const zoomAt = useMemo(() => {
    const shown = isFocusing ? [] : regions;
    const at = isFocusing
      ? zoomPath(shown)
      : zoomPath(shown, cursor, { x: cropX, y: cropY }, durationMs);
    return (seconds: number) => at(outputAt(shown, seconds * 1000));
  }, [isFocusing, regions, cursor, cropX, cropY, durationMs]);

  return (
    <Island className="relative min-h-0 flex-1 bg-canvas dot-grid">
      <div ref={ref} className="grid size-full place-items-center">
        <div
          className="grid place-items-center rounded-lg shadow-stage"
          style={{ ...frame, background: fillCss(appearance.fill, fileSrc) }}
        >
          <div className="relative" style={recording}>
            <div
              className="relative size-full overflow-hidden"
              style={{
                borderRadius: radius,
                boxShadow: `0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`,
              }}
            >
              <Zoom clock={clock} zoomAt={zoomAt}>
                <video
                  className="absolute max-w-none object-cover"
                  style={rectStyle(video)}
                  {...props}
                />
                <Blurs
                  clock={clock}
                  regions={regions}
                  video={video}
                  scale={scale}
                  editing={editing?.region.kind === "blur" ? editing : null}
                />
                <ClickRings
                  clock={clock}
                  rings={rings}
                  regions={regions}
                  video={video}
                  scale={scale}
                />
              </Zoom>
              {editing?.region.kind === "zoom" &&
              !followsCursor(editing.region) ? (
                <div className="absolute" style={rectStyle(picture)}>
                  <FocusBox {...editing} crop={{ x: cropX, y: cropY }} />
                </div>
              ) : null}
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
                startMs={kept[0].startMs}
                endMs={kept[kept.length - 1].endMs}
                video={video}
                size={recording}
                zoomAt={zoomAt}
              />
            </div>
          </div>
        </div>
      </div>
      <InEffect clock={clock} regions={regions} />
    </Island>
  );
}

function Blurs({
  clock,
  regions,
  video,
  scale,
  editing,
}: {
  clock: Clock;
  regions: Region[];
  video: Rect;
  scale: number;
  editing: Editing | null;
}) {
  const playing = useClockValue(clock, (seconds) =>
    regionAt(regions, "blur", seconds * 1000),
  );
  const blurStyle = (region: Region) => {
    const { box, radius } = blurOf(region);
    return {
      ...percentStyle(box),
      backdropFilter: `blur(${radius * scale}px)`,
    };
  };
  return (
    <div className="pointer-events-none absolute" style={rectStyle(video)}>
      {playing && playing.id !== editing?.region.id ? (
        <div className="absolute" style={blurStyle(playing)} />
      ) : null}
      {editing ? (
        <div
          data-keeps-editor
          className="pointer-events-auto absolute cursor-grab rounded-sm border-2 border-highlight active:cursor-grabbing"
          style={blurStyle(editing.region)}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            const drag = (target.dataset.corner ?? "move") as BoxDrag;
            const { width, height } =
              event.currentTarget.parentElement!.getBoundingClientRect();
            const { clientX: x, clientY: y } = event;
            const { box } = blurOf(editing.region);
            followPointer(
              (moved) =>
                editing.onChange({
                  box: draggedBox(box, drag, {
                    x: (moved.clientX - x) / width,
                    y: (moved.clientY - y) / height,
                  }),
                }),
              editing.onDone,
            );
          }}
        >
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <div
              key={corner}
              data-corner={corner}
              className={cn(
                "absolute size-3 -translate-1/2 rounded-full bg-highlight",
                corner === "nw" || corner === "se"
                  ? "cursor-nwse-resize"
                  : "cursor-nesw-resize",
              )}
              style={{
                left: corner.endsWith("w") ? 0 : "100%",
                top: corner.startsWith("n") ? 0 : "100%",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ClickRings({
  clock,
  rings,
  regions,
  video,
  scale,
}: {
  clock: Clock;
  rings: RingEvent[];
  regions: Region[];
  video: Rect;
  scale: number;
}) {
  const shown = useClockValue(clock, (seconds) =>
    ringsAt(rings, regions, seconds * 1000),
  );
  return shown.flatMap(({ index, progress }) => {
    const ring = rings[index];
    return ringCircles(ring.style, progress, ring.size).map((circle, at) => {
      const side = circle.radius * 2 * scale;
      return (
        <div
          key={`${index}-${at}`}
          className="pointer-events-none absolute -translate-1/2 rounded-full"
          style={{
            left: video.x + ring.x * video.width,
            top: video.y + ring.y * video.height,
            width: side,
            height: side,
            opacity: circle.alpha,
            background: circle.line > 0 ? undefined : ring.color,
            boxShadow:
              circle.line > 0
                ? `inset 0 0 0 ${circle.line * scale}px ${ring.color}`
                : undefined,
          }}
        />
      );
    });
  });
}

function Cursor({
  clock,
  track,
  settings,
  durationMs,
  startMs,
  endMs,
  video,
  size,
  zoomAt,
}: {
  clock: Clock;
  track: CursorTrack;
  settings: CursorSettings;
  durationMs: number;
  startMs: number;
  endMs: number;
  video: Rect;
  size: Size;
  zoomAt: ZoomAt;
}) {
  const spotAt = useMemo(
    () => cursorPath(track, settings, durationMs, { startMs, endMs }),
    [track, settings, durationMs, startMs, endMs],
  );
  const { style, hidesOutside } = nativeOr(settings);
  const pictures = useMemo(
    () => cursorPictures(track.images, style),
    [track.images, style],
  );
  const seen = useClockValue(clock, (seconds) => {
    const spot = spotAt(seconds * 1000);
    if (!spot) return null;
    const { scale, center } = zoomAt(seconds);
    const tip = zoomedTip(spot, video, size, { scale, ...center });
    const alpha =
      spot.alpha *
      outsideAlpha(hidesOutside, {
        x: tip.x / size.width,
        y: tip.y / size.height,
      });
    return alpha > 0 ? { spot: { ...spot, alpha }, tip, scale } : null;
  });
  if (!seen) return null;
  const { spot, tip } = seen;
  const px =
    cursorUnit(track, settings) * video.width * spot.scale * seen.scale;
  if (style === "Dot") {
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
  const shown = useClockValue(clock, (seconds) =>
    regionsAt(regions, seconds * 1000),
  );
  return (
    <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1">
      {shown.map((region) => {
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

type ZoomAt = (seconds: number) => { scale: number; center: Point };

function Zoom({
  clock,
  zoomAt,
  children,
}: {
  clock: Clock;
  zoomAt: ZoomAt;
  children: ReactNode;
}) {
  const scale = useClockValue(clock, (seconds) => zoomAt(seconds).scale);
  const origin = useClockValue(clock, (seconds) => {
    const { center } = zoomAt(seconds);
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

type Editing = {
  region: Region;
  onChange: (change: Partial<Pick<Region, "center" | "box">>) => void;
  onDone: () => void;
};

function FocusBox({
  region: zoom,
  onChange,
  onDone,
  crop,
}: Editing & { crop: Point }) {
  const box = focusBox(zoom, crop);
  return (
    <div data-keeps-editor className="absolute inset-0">
      <div
        className="absolute grid cursor-grab place-items-center rounded-sm border-2 border-highlight bg-highlight/16 active:cursor-grabbing"
        style={percentStyle(box)}
        onPointerDown={(event) => {
          const { width, height } =
            event.currentTarget.parentElement!.getBoundingClientRect();
          const { clientX: x, clientY: y } = event;
          followPointer(
            (moved) =>
              onChange({
                center: focusAt(
                  {
                    x: box.x + (moved.clientX - x) / width,
                    y: box.y + (moved.clientY - y) / height,
                  },
                  zoom.amount,
                  crop,
                ),
              }),
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
