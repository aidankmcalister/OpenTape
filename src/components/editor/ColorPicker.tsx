import { useState, type PointerEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  hexToHsv,
  hsvToHex,
  isHex,
  planeCss,
  type Hsv,
} from "@/lib/editor/color";
import { clamp } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import { Swatch } from "./Panel";

export type ColorOption = { value: string; color: string; label: string };

export function ColorSwatches({
  options,
  value,
  onChange,
  onPreview,
  onCommit,
}: {
  options: ColorOption[];
  value: string;
  onChange: (value: string) => void;
  onPreview: (color: string) => void;
  onCommit: () => void;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <ToggleGroup
      spacing={1}
      className="w-full justify-between"
      value={[chosen ? value : "custom"]}
      onValueChange={([next]) => next && next !== "custom" && onChange(next)}
    >
      {options.map((option) => (
        <Swatch
          key={option.value}
          value={option.value}
          aria-label={option.label}
          style={{ background: option.color }}
        />
      ))}
      <CustomSwatch fill={chosen ? null : value}>
        <PopoverTitle>Custom color</PopoverTitle>
        <ColorPicker
          color={chosen?.color ?? value}
          onPreview={onPreview}
          onChange={onChange}
          onCommit={onCommit}
        />
      </CustomSwatch>
    </ToggleGroup>
  );
}

export function CustomSwatch({
  fill,
  children,
}: {
  fill: string | null;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Swatch
            value="custom"
            aria-label="Custom"
            className={cn(
              !fill &&
                "border border-dashed border-muted-foreground text-muted-foreground hover:border-foreground hover:text-foreground data-popup-open:border-highlight data-popup-open:text-highlight",
            )}
            style={fill ? { background: fill } : undefined}
          />
        }
      >
        {fill ? null : <Plus className="size-3.5" />}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={20}
        collisionPadding={8}
        className="w-74"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default function ColorPicker({
  color,
  onPreview,
  onChange,
  onCommit,
  children,
}: {
  color: string;
  onPreview: (color: string) => void;
  onChange: (color: string) => void;
  onCommit: () => void;
  children?: ReactNode;
}) {
  const [hue, setHue] = useState(() => hexToHsv(color).h);
  const hsv = hexToHsv(color, hue);
  const preview = (next: Hsv) => {
    setHue(next.h);
    onPreview(hsvToHex(next));
  };
  return (
    <>
      <ColorPlane hsv={hsv} onChange={preview} onDone={onCommit} />
      <Slider
        variant="hue"
        max={359}
        value={[hsv.h]}
        onValueChange={(h) => preview({ ...hsv, h: Number(h) })}
        onValueCommitted={onCommit}
      />
      <div className="flex gap-2">
        <Input
          key={color}
          aria-label="Hex"
          defaultValue={color}
          className="font-mono"
          onBlur={(event) => {
            const hex = event.currentTarget.value;
            if (isHex(hex)) onChange(hex);
            else event.currentTarget.value = color;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {children}
      </div>
    </>
  );
}

function ColorPlane({
  hsv,
  onChange,
  onDone,
}: {
  hsv: Hsv;
  onChange: (hsv: Hsv) => void;
  onDone: () => void;
}) {
  const pick = (event: PointerEvent<HTMLElement>) => {
    const { left, top, width, height } =
      event.currentTarget.getBoundingClientRect();
    onChange({
      ...hsv,
      s: clamp((event.clientX - left) / width, 0, 1),
      v: 1 - clamp((event.clientY - top) / height, 0, 1),
    });
  };
  return (
    <div
      className="relative h-34 cursor-crosshair touch-none rounded-md"
      style={{ background: planeCss(hsv.h) }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
      }}
      onPointerUp={onDone}
    >
      <div
        className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-primary-foreground shadow-md"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: hsvToHex(hsv),
        }}
      />
    </div>
  );
}
