import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Move, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useElementSize } from "@/hooks/useElementSize";
import { useClockValue } from "@/hooks/editor/usePlayback";
import {
  type Appearance,
  type CursorSettings,
  fillCss,
  type KeySettings,
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
  type RegionKind,
} from "@/lib/editor/regions";
import {
  badgeAlpha,
  badgeSpans,
  badgeRect,
  badgeText,
  canvasMeasure,
  drawBadge,
} from "@/lib/editor/keys";
import { type Clip, keptClips } from "@/lib/editor/clips";
import type { Frames } from "@/lib/editor/playback";
import type { Clock } from "@/lib/time";
import Island from "./Island";
import { hueOf, REGION_ICONS, RegionValue } from "./timeline/kinds";
import { followPointer } from "@/hooks/usePointerHover";
import { cn } from "@/lib/utils";
import { frameDrawer } from "@/lib/editor/frameDrawer";

export default function Stage({
  solo,
  onSolo,
  ...props
}: FrameProps & {
  solo: RegionKind | null;
  onSolo: (kind: RegionKind) => void;
}) {
  return (
    <Island className="relative min-h-0 flex-1 bg-canvas dot-grid">
      <Frame {...props} />
      <InEffect clock={props.clock} regions={props.regions} />
      {solo ? (
        <Button
          variant="overlay"
          size="sm"
          className="absolute top-3 left-3"
          aria-label="Turn off solo"
          onClick={() => onSolo(solo)}
        >
          Solo: {REGIONS[solo].label}
          <X />
        </Button>
      ) : null}
    </Island>
  );
}

type FrameProps = {
  frames: Frames<VideoFrame> | null;
  videoSize: Size | null;
  fileSrc: (name: string) => string;
  appearance: Appearance;
  ratio: number;
  clock: Clock;
  regions: Region[];
  zoomRegions?: Region[];
  clips: Clip[];
  rings: RingEvent[];
  cursor: CursorTrack;
  durationMs: number;
  editing?: Editing | null;
  margin?: number;
};

export function Frame({
  frames,
  videoSize,
  fileSrc,
  appearance,
  ratio,
  clock,
  regions,
  zoomRegions = regions,
  clips,
  rings,
  cursor,
  durationMs,
  editing,
  margin,
}: FrameProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, picture, radius, shadow, border, video, scale } =
    frameLayout(appearance, size, ratio, margin);
  const isFocusing = editing?.region.kind === "zoom";
  const { x: cropX, y: cropY } = frameCrop(appearance, ratio);
  const kept = keptClips(clips, durationMs);
  const zoomAt = useMemo(() => {
    const shown = isFocusing ? [] : zoomRegions;
    const at = isFocusing
      ? zoomPath(shown)
      : zoomPath(shown, cursor, { x: cropX, y: cropY }, durationMs);
    return (seconds: number) => at(outputAt(shown, seconds * 1000));
  }, [isFocusing, zoomRegions, cursor, cropX, cropY, durationMs]);

  return (
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
              <Picture
                frames={frames}
                size={videoSize}
                clock={clock}
                video={video}
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
          <KeyBadges
            clock={clock}
            regions={regions}
            settings={appearance.keys}
            recording={recording}
            videoHeight={frame.height}
          />
          <div className="pointer-events-none absolute inset-0">
            <Cursor
              clock={clock}
              track={cursor}
              settings={appearance.cursor}
              durationMs={durationMs}
              endMs={kept[kept.length - 1].endMs}
              video={video}
              size={recording}
              zoomAt={zoomAt}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Picture({
  frames,
  size,
  clock,
  video,
}: {
  frames: Frames<VideoFrame> | null;
  size: Size | null;
  clock: Clock;
  video: Rect;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = canvas.current && frameDrawer(canvas.current);
    if (!frames || !draw) return;
    let drawn: VideoFrame | null = null;
    const show = () => {
      const frame = frames.frameAt(clock.seconds() * 1000);
      if (!frame || frame === drawn) return;
      drawn = frame;
      draw(frame);
    };
    show();
    const stops = [clock.subscribe(show), frames.subscribe(show)];
    return () => stops.forEach((stop) => stop());
  }, [frames, clock, size]);
  return (
    <canvas
      ref={canvas}
      width={size?.width}
      height={size?.height}
      className="absolute max-w-none"
      style={rectStyle(video)}
    />
  );
}

function KeyBadges({
  clock,
  regions,
  ...placed
}: {
  clock: Clock;
  regions: Region[];
  settings: KeySettings;
  recording: Size;
  videoHeight: number;
}) {
  const spans = useMemo(() => badgeSpans(regions), [regions]);
  const shown = useClockValue(clock, (seconds) =>
    spans.flatMap((span) => {
      const alpha = badgeAlpha(span, seconds * 1000);
      return alpha > 0
        ? [{ id: span.region.id, text: badgeText(span.region), alpha }]
        : [];
    }),
  );
  return shown.map(({ id, text, alpha }) => (
    <KeyBadge key={id} text={text} alpha={alpha} {...placed} />
  ));
}

function KeyBadge({
  text,
  alpha,
  settings,
  recording,
  videoHeight,
}: {
  text: string;
  alpha: number;
  settings: KeySettings;
  recording: Size;
  videoHeight: number;
}) {
  const measure = useMemo(() => canvasMeasure(), []);
  const rect = badgeRect(
    text,
    settings,
    { x: 0, y: 0, ...recording },
    videoHeight,
    measure,
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const pixels = window.devicePixelRatio;
  const [width, height] = rect ? [rect.width, rect.height] : [0, 0];
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || width === 0) return;
    context.setTransform(pixels, 0, 0, pixels, 0, 0);
    drawBadge(context, text, { width, height });
  }, [text, width, height, pixels]);
  if (!rect) return null;
  return (
    <canvas
      ref={canvas}
      width={Math.ceil(width * pixels)}
      height={Math.ceil(height * pixels)}
      className="pointer-events-none absolute max-w-none"
      style={{ ...rectStyle(rect), opacity: alpha }}
    />
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
        <DragBox
          box={blurOf(editing.region).box}
          style={blurStyle(editing.region)}
          hasCorners
          onDrag={(drag, from, moved) =>
            editing.onChange({ box: draggedBox(from, drag, moved) })
          }
          onDone={editing.onDone}
        />
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
  endMs,
  video,
  size,
  zoomAt,
}: {
  clock: Clock;
  track: CursorTrack;
  settings: CursorSettings;
  durationMs: number;
  endMs: number;
  video: Rect;
  size: Size;
  zoomAt: ZoomAt;
}) {
  const spotAt = useMemo(
    () => cursorPath(track, settings, durationMs, { startMs: 0, endMs }),
    [track, settings, durationMs, endMs],
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
            <RegionValue kind={region.kind} value={blockValue(region)} />
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
      <DragBox
        box={box}
        style={percentStyle(box)}
        className="grid place-items-center bg-highlight/16"
        onDrag={(_, from, moved) =>
          onChange({
            center: focusAt(
              { x: from.x + moved.x, y: from.y + moved.y },
              zoom.amount,
              crop,
            ),
          })
        }
        onDone={onDone}
      >
        <div className="grid size-6 place-items-center rounded-full bg-highlight text-primary-foreground">
          <Move className="size-3.5" />
        </div>
      </DragBox>
    </div>
  );
}

/** A box on the stage that drags by its body, and by its corners when it has them. `moved` is a share of the parent's size. */
function DragBox({
  box,
  style,
  className,
  hasCorners = false,
  onDrag,
  onDone,
  children,
}: {
  box: Rect;
  style: CSSProperties;
  className?: string;
  hasCorners?: boolean;
  onDrag: (drag: BoxDrag, from: Rect, moved: Point) => void;
  onDone: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      data-keeps-editor
      className={cn(
        "pointer-events-auto absolute cursor-grab rounded-sm border-2 border-highlight active:cursor-grabbing",
        className,
      )}
      style={style}
      onPointerDown={(event) => {
        const drag = ((event.target as HTMLElement).dataset.corner ??
          "move") as BoxDrag;
        const { width, height } =
          event.currentTarget.parentElement!.getBoundingClientRect();
        const { clientX: x, clientY: y } = event;
        followPointer(
          (moved) =>
            onDrag(drag, box, {
              x: (moved.clientX - x) / width,
              y: (moved.clientY - y) / height,
            }),
          onDone,
        );
      }}
    >
      {children}
      {hasCorners
        ? (["nw", "ne", "sw", "se"] as const).map((corner) => (
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
          ))
        : null}
    </div>
  );
}
