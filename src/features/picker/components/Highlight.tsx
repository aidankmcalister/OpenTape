import { memo } from "react";
import { AppWindow, Monitor } from "lucide-react";
import CaptureBar, { CaptureTile } from "./CaptureBar";
import { roundedRectPath, type Rect } from "@/lib/geometry";
import {
  sameHighlight,
  type Highlight as HighlightData,
} from "@/features/picker/lib/pickerView";
import DimOutside from "./DimOutside";

/** Roughly the corner of a macOS window, so the tint sits inside it. */
const WINDOW_CORNER = 10;

/** Below this width the bar drops the name and size so it always fits inside the window. */
const COMPACT_BELOW = 300;

/** Redrawn only when the highlight changes, not on every cursor move within one window. */
export default memo(Highlight, (previous, next) =>
  sameHighlight(previous.highlight, next.highlight),
);

function Highlight({
  highlight,
  onRecord,
}: {
  highlight: HighlightData;
  onRecord: () => void;
}) {
  const { rect, covered, label, title, icon, size, target } = highlight;
  const isDisplay = target.kind === "display";
  return (
    <div className="fixed inset-0 overflow-hidden">
      <Shade
        rect={rect}
        covered={covered}
        corner={isDisplay ? 0 : WINDOW_CORNER}
        dimsOutside={!isDisplay}
      />
      {label && (
        <div
          className="absolute flex items-center justify-center"
          style={{
            left: label.x,
            top: label.y,
            width: label.width,
            height: label.height,
          }}
        >
          <CaptureBar
            icon={
              <CaptureTile src={icon}>
                {isDisplay ? <Monitor /> : <AppWindow />}
              </CaptureTile>
            }
            title={title}
            size={size}
            isCompact={label.width < COMPACT_BELOW}
            onRecord={onRecord}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Tints what will be recorded and dims the rest. Parts of the target that other windows cover
 * get the dim, not the tint, so only what you can see lights up. Plain boxes and a clip path,
 * rather than SVG masks, which WebKit redraws slowly at the size of a display.
 */
function Shade({
  rect,
  covered,
  corner,
  dimsOutside,
}: {
  rect: Rect;
  covered: Rect[];
  corner: number;
  dimsOutside: boolean;
}) {
  const visible = [
    roundedRectPath(rect, corner),
    ...covered.map((part) => roundedRectPath(part, 0)),
  ].join("");
  return (
    <>
      {dimsOutside && <DimOutside rect={rect} />}
      {covered.map((part, index) => (
        <div
          key={index}
          className="absolute bg-dim"
          style={{
            left: part.x,
            top: part.y,
            width: part.width,
            height: part.height,
          }}
        />
      ))}
      <div
        className="absolute inset-0 bg-tint"
        style={{ clipPath: `path(evenodd, "${visible}")` }}
      />
    </>
  );
}
