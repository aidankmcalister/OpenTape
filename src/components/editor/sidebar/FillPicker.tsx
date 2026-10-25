import { useRef, useState, type PointerEvent } from "react";
import { PopoverTitle } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { Edits } from "@/hooks/editor/useProject";
import type { ExportGradient } from "@/lib/bindings";
import {
  changeStop,
  fillCss,
  gradientCss,
  type Fill,
} from "@/lib/editor/appearance";
import { changeAppearance } from "@/lib/editor/project";
import { clamp } from "@/lib/geometry";
import ColorPicker, { CustomSwatch } from "../ColorPicker";
import { ValueInput } from "../Panel";

export default function FillPicker({ edits }: { edits: Edits }) {
  const { fill } = edits.project.appearance;
  const isColor = fill.kind === "color";
  const [selected, setSelected] = useState(0);
  const index = isColor ? 0 : selected;
  const custom =
    (gradient: ExportGradient) =>
    (project: Parameters<typeof changeAppearance>[0]) =>
      changeAppearance(project, {
        fill: { ...fill, preset: "custom", custom: gradient } satisfies Fill,
      });
  const preview = (gradient: ExportGradient) => edits.preview(custom(gradient));
  const change = (gradient: ExportGradient) => edits.change(custom(gradient));
  return (
    <CustomSwatch fill={fill.preset === "custom" ? fillCss(fill) : null}>
      <PopoverTitle>
        {isColor ? "Custom color" : "Custom gradient"}
      </PopoverTitle>
      {isColor ? null : (
        <GradientBar
          gradient={fill.custom}
          selected={index}
          onSelect={setSelected}
          onMove={(at) => preview(changeStop(fill.custom, index, { at }))}
          onDone={edits.commit}
        />
      )}
      <ColorPicker
        key={index}
        color={fill.custom.stops[index].color}
        onPreview={(color) =>
          preview(changeStop(fill.custom, index, { color }))
        }
        onChange={(color) => change(changeStop(fill.custom, index, { color }))}
        onCommit={edits.commit}
      >
        {isColor ? null : (
          <Slider
            max={360}
            value={[fill.custom.angle]}
            onValueChange={(angle) =>
              preview({ ...fill.custom, angle: Number(angle) })
            }
            onValueCommitted={edits.commit}
          >
            <span>Angle</span>
            <ValueInput
              label="Angle"
              value={fill.custom.angle}
              unit="°"
              onChange={(angle) =>
                change({
                  ...fill.custom,
                  angle: Math.round(clamp(angle, 0, 360)),
                })
              }
            />
          </Slider>
        )}
      </ColorPicker>
    </CustomSwatch>
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
