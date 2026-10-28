import { memo } from "react";
import { AppWindow, Monitor } from "lucide-react";
import { rectStyle, roundedRectPath } from "@/lib/geometry";
import AreaBox from "@/components/picker/AreaBox";
import CaptureBar, {
  CaptureTile,
  Countdown,
  DimOutside,
} from "@/components/picker/CaptureBar";
import {
  sameHighlight,
  type Highlight as HighlightData,
} from "@/lib/picker/view";
import { usePicker } from "@/hooks/picker/usePicker";

export default function Picker({ displayId }: { displayId: number }) {
  const { view, framing, countdown, record } = usePicker(displayId);
  if (framing.windowRect) {
    return (
      <div className="fixed inset-0">
        <DimOutside rect={framing.windowRect} />
        <div className="absolute" style={rectStyle(framing.windowRect)}>
          <Countdown value={countdown} />
        </div>
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
        countdown={countdown}
      />
    );
  }
  if (framing.isFraming) {
    return (
      <div className="fixed inset-0">
        <Countdown value={countdown} />
      </div>
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
