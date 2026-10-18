import { AppWindow, Monitor } from "lucide-react";
import type { Highlight as HighlightData } from "@/lib/pickerView";
import Pill from "@/components/Pill";
import RecordButton from "@/components/RecordButton";
import DimOutside from "./DimOutside";

/** Below this width the pill drops the name and size so it always fits inside the window. */
const COMPACT_BELOW = 280;

export default function Highlight({
  highlight,
  onRecord,
}: {
  highlight: HighlightData;
  onRecord: () => void;
}) {
  const { rect, label, title, icon, size, target } = highlight;
  const isDisplay = target.kind === "display";
  return (
    <div className="fixed inset-0 overflow-hidden">
      {!isDisplay && <DimOutside rect={rect} />}
      <div
        className="absolute rounded-[10px] border-2 border-highlight outline outline-edge"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
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
          <Pill className="gap-2 shadow-pill">
            {isDisplay ? <DisplayIcon /> : <AppIcon src={icon} />}
            {label.width >= COMPACT_BELOW && (
              <div className="pr-1">
                <p className="leading-5 text-foreground">{title}</p>
                <p className="text-xs leading-4 font-normal text-muted-foreground tabular-nums">
                  {inPixels(size.width)} × {inPixels(size.height)}
                </p>
              </div>
            )}
            <RecordButton onClick={onRecord} />
          </Pill>
        </div>
      )}
    </div>
  );
}

function DisplayIcon() {
  return (
    <span className="grid size-10 place-items-center rounded-full bg-highlight/16 text-highlight">
      <Monitor className="size-4" />
    </span>
  );
}

function AppIcon({ src }: { src: string | null }) {
  return (
    <span className="grid size-10 place-items-center">
      {src ? (
        <img src={src} alt="" className="size-8" />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg bg-white/8 text-muted-foreground">
          <AppWindow className="size-4" />
        </span>
      )}
    </span>
  );
}

/** Shows the size the recording will have, which is in pixels on this display. */
function inPixels(points: number): number {
  return Math.round(points * window.devicePixelRatio);
}
