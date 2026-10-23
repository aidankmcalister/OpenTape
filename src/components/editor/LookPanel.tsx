import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  changeLook,
  COLORS,
  DEFAULT_LOOK,
  fillCss,
  GRADIENTS,
  type Amount,
  type Fill,
} from "@/lib/editor/edits";
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
        <Tabs
          value={look.fill.kind}
          onValueChange={(kind: Fill["kind"]) =>
            changeFill({ ...look.fill, kind })
          }
        >
          <TabsList className="w-full">
            <TabsTrigger value="gradient">Gradient</TabsTrigger>
            <TabsTrigger value="color">Color</TabsTrigger>
          </TabsList>
        </Tabs>
        <ToggleGroup
          className="w-full justify-between"
          value={[String(look.fill.preset)]}
          onValueChange={([preset]) =>
            preset && changeFill({ ...look.fill, preset: Number(preset) })
          }
        >
          {presets.map((_, preset) => (
            <ToggleGroupItem
              key={preset}
              value={String(preset)}
              aria-label={`Preset ${preset + 1}`}
              className="size-7 min-w-7 rounded-full p-0 aria-pressed:ring-2 aria-pressed:ring-highlight aria-pressed:ring-offset-2 aria-pressed:ring-offset-card"
              style={{ background: fillCss({ ...look.fill, preset }) }}
            />
          ))}
        </ToggleGroup>
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
  return (
    <Slider
      variant="field"
      max={max}
      value={[value]}
      onValueChange={(next) => onChange(Number(next))}
      onValueCommitted={onCommit}
    >
      <span>{label}</span>
      <span className="font-mono">
        {value} {unit}
      </span>
    </Slider>
  );
}
