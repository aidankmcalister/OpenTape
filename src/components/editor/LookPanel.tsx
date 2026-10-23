import type { PointerEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  amountFromShare,
  changeLook,
  COLORS,
  DEFAULT_LOOK,
  fillCss,
  GRADIENTS,
  type Amount,
  type Fill,
} from "@/lib/editor/edits";
import { cn } from "@/lib/utils";
import Island from "./Island";

const SECTIONS: { title: string; amounts: Amount[] }[] = [
  { title: "Frame", amounts: ["padding", "radius"] },
  {
    title: "Shadow",
    amounts: ["shadowOpacity", "shadowBlur", "shadowOffsetY"],
  },
];

export default function LookPanel({ edits }: { edits: Edits }) {
  const { look } = edits.project;
  const presets = look.fill.kind === "color" ? COLORS : GRADIENTS;
  const changeFill = (fill: Fill) =>
    edits.change((project) => changeLook(project, { fill }));
  return (
    <Island className="flex w-74 shrink-0 flex-col">
      <h2 className="flex h-14 shrink-0 items-center border-b border-hairline px-3 text-ui font-semibold">
        Background
      </h2>
      <Section title="Fill">
        <ToggleGroup
          value={[look.fill.kind]}
          onValueChange={([kind]) =>
            kind && changeFill({ ...look.fill, kind: kind as Fill["kind"] })
          }
        >
          <ToggleGroupItem value="gradient">Gradient</ToggleGroupItem>
          <ToggleGroupItem value="color">Color</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex gap-2">
          {presets.map((_, preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Preset ${preset + 1}`}
              className={cn(
                "size-6 rounded-full",
                preset === look.fill.preset &&
                  "ring-2 ring-highlight ring-offset-2 ring-offset-card",
              )}
              style={{ background: fillCss({ ...look.fill, preset }) }}
              onClick={() => changeFill({ ...look.fill, preset })}
            />
          ))}
        </div>
      </Section>
      {SECTIONS.map(({ title, amounts }) => (
        <Section key={title} title={title}>
          {amounts.map((amount) => (
            <ValueField
              key={amount}
              amount={amount}
              value={look[amount]}
              onChange={(value) =>
                edits.preview((project) =>
                  changeLook(project, { [amount]: value }),
                )
              }
              onCommit={edits.commit}
            />
          ))}
        </Section>
      ))}
      <div className="mt-auto p-3">
        <Button
          variant="secondary"
          size="pill-sm"
          className="w-full"
          onClick={() =>
            edits.change((project) => changeLook(project, DEFAULT_LOOK))
          }
        >
          Reset all
        </Button>
      </div>
    </Island>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-hairline p-3">
      <h3 className="text-ui font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function ValueField({
  amount,
  value,
  onChange,
  onCommit,
}: {
  amount: Amount;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const { label, max, unit } = AMOUNTS[amount];
  const percent = (value / max) * 100;
  const valueAt = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return amountFromShare(
      amount,
      (event.clientX - bounds.left) / bounds.width,
    );
  };
  return (
    <div
      className="relative flex h-8 cursor-ew-resize items-center justify-between overflow-hidden rounded-md border border-hairline bg-secondary px-3 text-caption select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(valueAt(event));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          onChange(valueAt(event));
        }
      }}
      onPointerUp={onCommit}
    >
      <div
        className="absolute inset-y-0 left-0 bg-highlight/20"
        style={{ width: `${percent}%` }}
      />
      <div
        className="absolute inset-y-0 w-px bg-highlight"
        style={{ left: `${percent}%` }}
      />
      <span className="relative">{label}</span>
      <span className="relative font-mono">
        {value} {unit}
      </span>
    </div>
  );
}
