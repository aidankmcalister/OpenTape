import type { Editor } from "@/features/editor/hooks/useEditor";
import { useElementSize } from "@/hooks/useElementSize";
import { fitInside } from "@/lib/geometry";
import { FRAME_WIDTH, fillCss } from "@/features/editor/lib/look";
import Island from "./Island";

/** Room between the frame and the canvas's edges, in points. */
const CANVAS_MARGIN = 48;
const DEFAULT_RATIO = 16 / 9;
/** How quickly a zoom eases in and out as the playhead crosses a zoom region. */
const ZOOM_EASE = "transform 600ms cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The recording as it will export: the background, then the recording inset by the padding,
 * with its corners, shadow and border. Look sizes are scaled from a 1920-wide frame.
 */
export default function Stage({ editor }: { editor: Editor }) {
  const { ref: canvasRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const { look, zoom, playback } = editor;
  const ratio = playback.videoSize
    ? playback.videoSize.width / playback.videoSize.height
    : DEFAULT_RATIO;
  const frame = fitInside(
    {
      width: Math.max(canvasSize.width - CANVAS_MARGIN * 2, 0),
      height: Math.max(canvasSize.height - CANVAS_MARGIN * 2, 0),
    },
    ratio,
  );
  const scale = frame.width / FRAME_WIDTH;
  const padding = look.padding * scale;
  const screen = fitInside(
    {
      width: Math.max(frame.width - padding * 2, 0),
      height: Math.max(frame.height - padding * 2, 0),
    },
    ratio,
  );
  const inset = look.inset * scale;

  return (
    <Island className="relative min-h-0 flex-1 bg-canvas">
      <div
        ref={canvasRef}
        className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle,rgb(255_255_255/0.07)_1px,transparent_1px)] bg-size-[16px_16px] bg-position-[8px_8px]"
      >
        <div
          className="relative grid place-items-center overflow-hidden rounded-lg border border-glass-border shadow-[0_24px_48px_rgb(0_0_0/0.45)]"
          style={{ ...frame, background: fillCss(look.fill) }}
        >
          <div
            className="relative overflow-hidden"
            style={{
              ...screen,
              borderRadius: look.radius * scale,
              boxShadow: `0 ${look.shadowOffsetY * scale}px ${look.shadowBlur * scale}px rgb(0 0 0 / ${look.shadowOpacity / 100})`,
              outline: `${look.borderWidth * scale}px solid rgb(255 255 255 / 0.35)`,
              outlineOffset: -look.borderWidth * scale,
            }}
          >
            <video
              className="absolute max-w-none object-cover"
              style={{
                inset: -inset,
                width: `calc(100% + ${inset * 2}px)`,
                height: `calc(100% + ${inset * 2}px)`,
                transform: `scale(${zoom})`,
                transition: ZOOM_EASE,
              }}
              {...playback.videoProps}
            />
          </div>
        </div>
      </div>
    </Island>
  );
}
