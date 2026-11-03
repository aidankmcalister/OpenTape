import { memo } from "react";
import { AppWindow, Monitor } from "lucide-react";
import { rectStyle, type RoundedRect } from "@/lib/geometry";
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
  if (framing.isFraming) return null;
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
    const shapes = (window: string, inFront: string) => (
      <>
        <Shape shape={rect} fill={window} />
        {covered.map((front, index) => (
          <Shape key={index} shape={front} fill={inFront} />
        ))}
      </>
    );
    return (
      <div className="fixed inset-0 overflow-hidden">
        <svg className="absolute inset-0 size-full">
          <mask id="visible">{shapes("white", "black")}</mask>
          <mask id="hidden">
            <rect width="100%" height="100%" fill="white" />
            {shapes("black", "white")}
          </mask>
          <rect
            width="100%"
            height="100%"
            className="fill-dim"
            mask="url(#hidden)"
          />
          <rect
            width="100%"
            height="100%"
            className="fill-tint"
            mask="url(#visible)"
          />
        </svg>
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

function Shape({
  shape: { corner, ...rect },
  fill,
}: {
  shape: RoundedRect;
  fill: string;
}) {
  return <rect {...rect} rx={corner} fill={fill} />;
}
