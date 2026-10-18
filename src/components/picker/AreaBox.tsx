import Pill, { PillDivider, pillItem } from "@/components/Pill";
import RecordButton from "@/components/RecordButton";
import { useAreaBox, type AreaBox as AreaBoxState } from "@/hooks/useAreaBox";
import { RATIOS, type Handle } from "@/lib/geometry";
import type { DisplayInfo } from "@/lib/picker";
import DimOutside from "./DimOutside";

/** The bar's rendered size, so the box logic can keep it on screen. */
const BAR_SIZE = { width: 456, height: 48 };

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
  startsHere,
}: {
  display: DisplayInfo;
  startsHere: boolean;
}) {
  const box = useAreaBox(display, startsHere, BAR_SIZE);
  if (!box.hasBox)
    return <div className="fixed inset-0 bg-dim" {...box.claimProps} />;

  const { area, barPosition } = box;
  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden"
      {...box.surfaceProps}
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
        {...box.boxProps}
      >
        {HANDLES.map(({ handle, left, top, cursor }) => (
          <div
            key={handle}
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-highlight bg-foreground"
            style={{ left, top, cursor }}
            {...box.handleProps(handle)}
          />
        ))}
      </div>
      <div
        className="absolute flex justify-center"
        style={{
          left: barPosition.x,
          top: barPosition.y,
          width: BAR_SIZE.width,
        }}
        {...box.barProps}
      >
        <AreaBar box={box} />
      </div>
    </div>
  );
}

function AreaBar({ box }: { box: AreaBoxState }) {
  return (
    <Pill className="cursor-default shadow-pill">
      <div className="flex items-center gap-2 px-3">
        <SizeField
          label="W"
          value={box.area.width}
          onChange={(value) => box.setSize("width", value)}
        />
        <SizeField
          label="H"
          value={box.area.height}
          onChange={(value) => box.setSize("height", value)}
        />
      </div>
      <PillDivider size="sm" />
      {RATIOS.map((ratio) => (
        <button
          key={ratio.label}
          onClick={() => box.chooseRatio(ratio)}
          className={pillItem({
            size: "sm",
            active: box.ratio?.label === ratio.label,
          })}
        >
          {ratio.label}
        </button>
      ))}
      <PillDivider size="sm" />
      <RecordButton size="sm" onClick={box.start} />
    </Pill>
  );
}

function SizeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="w-[4ch] bg-transparent tabular-nums outline-none [appearance:textfield] focus:text-highlight [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  );
}
