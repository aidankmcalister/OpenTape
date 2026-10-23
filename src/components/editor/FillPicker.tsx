import { useRef, useState, type PointerEvent } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Edits } from "@/hooks/editor/useProject";
import type { ExportGradient } from "@/lib/bindings";
import { changeStop, gradientCss, type Fill } from "@/lib/editor/appearance";
import {
  hexToHsv,
  hsvToHex,
  isHex,
  planeCss,
  type Hsv,
} from "@/lib/editor/color";
import { changeAppearance } from "@/lib/editor/project";
import { clamp } from "@/lib/geometry";

export default function FillPicker({ edits }: { edits: Edits }) {
  const { fill } = edits.project.appearance;
  const isColor = fill.kind === "color";
  const [selected, setSelected] = useState(0);
  const index = isColor ? 0 : selected;
  const stop = fill.custom.stops[index];
  const [hue, setHue] = useState(() => hexToHsv(stop.color).h);
  const hsv = hexToHsv(stop.color, hue);
  const custom =
    (gradient: ExportGradient) =>
    (project: Parameters<typeof changeAppearance>[0]) =>
      changeAppearance(project, {
        fill: { ...fill, preset: "custom", custom: gradient } satisfies Fill,
      });
  const preview = (gradient: ExportGradient) => edits.preview(custom(gradient));
  const change = (gradient: ExportGradient) => edits.change(custom(gradient));
  const previewColor = (next: Hsv) => {
    setHue(next.h);
    preview(changeStop(fill.custom, index, { color: hsvToHex(next) }));
  };
  const select = (at: number) => {
    setSelected(at);
    setHue(hexToHsv(fill.custom.stops[at].color).h);
  };
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ToggleGroupItem
            value="custom"
            aria-label="Custom"
            className="size-6 min-w-6 rounded-full border border-dashed border-muted-foreground p-0 aria-pressed:swatch-ring data-popup-open:border-2 data-popup-open:border-solid data-popup-open:border-highlight data-popup-open:bg-highlight/16"
          />
        }
      >
        <Plus className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={20}
        className="w-74 gap-3 p-3"
      >
        <PopoverTitle className="flex h-6 items-center text-ui font-semibold">
          {isColor ? "Custom color" : "Custom gradient"}
        </PopoverTitle>
        {isColor ? null : (
          <GradientBar
            gradient={fill.custom}
            selected={index}
            onSelect={select}
            onMove={(at) => preview(changeStop(fill.custom, index, { at }))}
            onDone={edits.commit}
          />
        )}
        <ColorPlane hsv={hsv} onChange={previewColor} onDone={edits.commit} />
        <Slider
          variant="hue"
          max={359}
          value={[hsv.h]}
          onValueChange={(h) => previewColor({ ...hsv, h: Number(h) })}
          onValueCommitted={edits.commit}
        />
        <div className="flex gap-2">
          <Input
            key={stop.color}
            aria-label="Hex"
            defaultValue={stop.color}
            className="font-mono"
            onBlur={(event) => {
              const hex = event.currentTarget.value;
              if (isHex(hex))
                change(changeStop(fill.custom, index, { color: hex }));
              else event.currentTarget.value = stop.color;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {isColor ? null : (
            <Slider
              variant="field"
              max={360}
              value={[fill.custom.angle]}
              onValueChange={(angle) =>
                preview({ ...fill.custom, angle: Number(angle) })
              }
              onValueCommitted={edits.commit}
            >
              <span>Angle</span>
              <span className="font-mono font-medium">
                {fill.custom.angle}°
              </span>
            </Slider>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GradientBar({
  gradient,
  selected,
  onSelect,
  onMove,
  onDone,
}: {
  gradient: ExportGradient;
  selected: number;
  onSelect: (index: number) => void;
  onMove: (at: number) => void;
  onDone: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!bar.current || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const { left, width } = bar.current.getBoundingClientRect();
    onMove(clamp((event.clientX - left) / width, 0, 1));
  };
  return (
    <div
      ref={bar}
      className="relative mx-2 h-8 rounded-md"
      style={{ background: gradientCss({ ...gradient, angle: 90 }) }}
    >
      {gradient.stops.map((stop, index) => (
        <button
          key={index}
          type="button"
          aria-label={`Stop ${index + 1}`}
          data-selected={index === selected}
          className="absolute top-1/2 size-4 -translate-1/2 rounded-full border-2 border-primary-foreground shadow-md data-[selected=true]:ring-2 data-[selected=true]:ring-highlight"
          style={{ left: `${stop.at * 100}%`, background: stop.color }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onSelect(index);
          }}
          onPointerMove={move}
          onPointerUp={onDone}
        />
      ))}
    </div>
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
