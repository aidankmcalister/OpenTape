import { memo } from "react";
import { AppWindow, Monitor } from "lucide-react";
import { rectStyle, roundedRectPath } from "@/lib/geometry";
import AreaBox from "@/components/picker/AreaBox";
import CaptureBar, {
  CaptureTile,
  DimOutside,
} from "@/components/picker/CaptureBar";
import {
  sameHighlight,
  type Highlight as HighlightData,
} from "@/lib/picker/view";
import { usePicker } from "@/hooks/picker/usePicker";

export default function Picker({ displayId }: { displayId: number }) {
  const { view, framing, record } = usePicker(displayId);
  if (framing.windowRect) {
    return (
      <div className="fixed inset-0">
        <DimOutside rect={framing.windowRect} />
      </div>
    );
  }
  if (!view) return null;
  if (view.mode === "area") {
    return (
      <AreaBox
        display={view.display}
        hasBox={view.hasBox}
        isFraming={framing.isFraming}
      />
    );
  }
  const { highlight } = view;
  if (!highlight) return <div className="fixed inset-0 bg-dim" />;
  return (
    <Highlight
      highlight={highlight}
      onRecord={() => record(highlight.target)}
    />
  );
}

// Plain boxes and a clip path, because WebKit redraws SVG masks slowly at display size.
const Highlight = memo(
  function Highlight({
    highlight,
    onRecord,
  }: {
    highlight: HighlightData;
    onRecord: () => void;
  }) {
    const { rect, covered, barRect, title, icon, size, target } = highlight;
    const isDisplay = target.kind === "display";
    // About a macOS window's corner radius.
    const corner = isDisplay ? 0 : 10;
    const visible = [
      roundedRectPath(rect, corner),
      ...covered.map((part) => roundedRectPath(part, 0)),
    ].join("");
    return (
      <div className="fixed inset-0 overflow-hidden">
        {!isDisplay && <DimOutside rect={rect} />}
        {covered.map((part, index) => (
          <div
            key={index}
            className="absolute bg-dim"
            style={rectStyle(part)}
          />
        ))}
        <div
          className="absolute inset-0 bg-tint"
          style={{ clipPath: `path(evenodd, "${visible}")` }}
        />
        {barRect && (
          <div
            className="absolute flex items-center justify-center"
            style={rectStyle(barRect)}
          >
            <CaptureBar
              icon={
                <CaptureTile src={icon}>
                  {isDisplay ? <Monitor /> : <AppWindow />}
                </CaptureTile>
              }
              title={title}
              size={size}
              isCompact={barRect.width < 300}
              onRecord={onRecord}
            />
          </div>
        )}
      </div>
    );
  },
  (previous, next) => sameHighlight(previous.highlight, next.highlight),
);
