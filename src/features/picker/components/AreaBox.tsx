import { Scan } from "lucide-react";
import CaptureBar, { CaptureTile } from "./CaptureBar";
import { useAreaBox } from "@/features/picker/hooks/useAreaBox";
import type { Handle } from "@/features/picker/lib/area";
import type { DisplayInfo } from "@/lib/bindings/DisplayInfo";
import DimOutside from "./DimOutside";
import RatioChip from "./RatioChip";

/** The bar's rendered size, so the box logic can keep it on screen. */
const BAR_SIZE = { width: 440, height: 58 };

const HANDLES: { handle: Handle; left: string; top: string; cursor: string }[] =
  [
    { handle: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
    { handle: "n", left: "50%", top: "0%", cursor: "ns-resize" },
    { handle: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
    { handle: "e", left: "100%", top: "50%", cursor: "ew-resize" },
    { handle: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
    { handle: "s", left: "50%", top: "100%", cursor: "ns-resize" },
    { handle: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
    { handle: "w", left: "0%", top: "50%", cursor: "ew-resize" },
  ];

/**
 * The Area box: drag, resize and size it, then Record. While it records, it stays as a frame,
 * dimming everything else, with its handles and bar gone.
 */
export default function AreaBox({
  display,
  hasBox,
  isFraming,
}: {
  display: DisplayInfo;
  hasBox: boolean;
  isFraming: boolean;
}) {
  const box = useAreaBox(display, hasBox, BAR_SIZE);
  if (!hasBox)
    return <div className="fixed inset-0 bg-dim" {...box.claimProps} />;

  const { area, barPosition } = box;
  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden"
      {...(isFraming ? {} : box.surfaceProps)}
    >
      <DimOutside rect={area} />
      <div
        className="absolute cursor-move border-2 border-highlight outline outline-edge"
        style={{
          left: area.x,
          top: area.y,
          width: area.width,
          height: area.height,
        }}
        {...(isFraming ? {} : box.boxProps)}
      >
        {!isFraming &&
          HANDLES.map(({ handle, left, top, cursor }) => (
            <div
              key={handle}
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-highlight bg-foreground"
              style={{ left, top, cursor }}
              {...box.handleProps(handle)}
            />
          ))}
      </div>
      {!isFraming && (
        <div
          className="absolute flex justify-center"
          style={{
            left: barPosition.x,
            top: barPosition.y,
            width: BAR_SIZE.width,
          }}
          {...box.barProps}
        >
          <CaptureBar
            icon={
              <CaptureTile>
                <Scan />
              </CaptureTile>
            }
            title="Area"
            size={box.size}
            control={
              <RatioChip
                ratio={box.ratio}
                safeTop={display.safeTop}
                onChoose={box.chooseRatio}
              />
            }
            onRecord={box.start}
          />
        </div>
      )}
    </div>
  );
}
