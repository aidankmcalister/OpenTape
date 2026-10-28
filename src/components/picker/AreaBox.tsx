import { ChevronDown, Proportions, Scan, SquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DisplayInfo } from "@/lib/bindings";
import { rectStyle } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import { RATIOS, type Handle, type Ratio } from "@/lib/picker/area";
import CaptureBar, { CaptureTile, Countdown, DimOutside } from "./CaptureBar";
import { useAreaBox } from "@/hooks/picker/useAreaBox";

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

export default function AreaBox({
  display,
  hasBox,
  isFraming,
  countdown,
}: {
  display: DisplayInfo;
  hasBox: boolean;
  isFraming: boolean;
  countdown: number | null;
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
        style={rectStyle(area)}
        {...(isFraming ? {} : box.boxProps)}
      >
        <Countdown value={countdown} />
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
            onRecord={box.record}
          />
        </div>
      )}
    </div>
  );
}

const FREE = "free";
const MENU_GAP = 8;

function RatioChip({
  ratio,
  safeTop,
  onChoose,
}: {
  ratio: Ratio | null;
  safeTop: number;
  onChoose: (ratio: Ratio | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="pill" className="group" />}
      >
        <Proportions className={cn(ratio && "text-highlight")} />
        {ratio?.label ?? "Free"}
        <ChevronDown className="text-muted-foreground transition-transform group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={MENU_GAP}
        collisionPadding={{ top: safeTop + MENU_GAP }}
        className="w-44"
      >
        <DropdownMenuRadioGroup
          value={ratio?.label ?? FREE}
          onValueChange={(label) =>
            onChoose(RATIOS.find((choice) => choice.label === label) ?? null)
          }
        >
          <DropdownMenuRadioItem value={FREE}>
            <SquareDashed className="text-muted-foreground" />
            Free
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {RATIOS.map((choice) => (
            <DropdownMenuRadioItem key={choice.label} value={choice.label}>
              <span className="grid size-4 place-items-center text-muted-foreground">
                <span
                  className="rounded-[2px] border-[1.5px] border-current"
                  style={{
                    width: choice.value >= 1 ? 13 : 13 * choice.value,
                    height: choice.value >= 1 ? 13 / choice.value : 13,
                  }}
                />
              </span>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
