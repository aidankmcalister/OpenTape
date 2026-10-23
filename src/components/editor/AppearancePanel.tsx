import { Blend, Image, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  BORDER_COLORS,
  changeAppearance,
  COLORS,
  DEFAULT_APPEARANCE,
  fillCss,
  GRADIENTS,
  NEW_PROJECT,
  type Amount,
  type BorderColor,
  type Fill,
} from "@/lib/editor/edits";
import { PanelHeader, Section } from "./Panel";

const SECTIONS: { title: string; amounts: Amount[] }[] = [
  { title: "Frame", amounts: ["padding", "radius", "inset"] },
  {
    title: "Shadow",
    amounts: ["shadowOpacity", "shadowBlur", "shadowOffsetY"],
  },
];

export default function AppearancePanel({ edits }: { edits: Edits }) {
  const { appearance } = edits.project;
  const presets = appearance.fill.kind === "color" ? COLORS : GRADIENTS;
  const changeFill = (fill: Fill) =>
    edits.change((project) => changeAppearance(project, { fill }));
  return (
    <>
      <PanelHeader
        title="Background"
        onReset={() =>
          edits.change((project) =>
            changeAppearance(project, DEFAULT_APPEARANCE),
          )
        }
      />
      <Section title="Fill">
        <Tabs
          value={appearance.fill.kind}
          onValueChange={(kind: Fill["kind"]) =>
            changeFill({ ...appearance.fill, kind })
          }
        >
          <TabsList className="w-full">
            <TabsTrigger value="gradient">
              <Blend />
              Gradient
            </TabsTrigger>
            <TabsTrigger value="color">
              <Palette />
              Color
            </TabsTrigger>
            <TabsTrigger value="image" disabled>
              <Image />
              Image
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <ToggleGroup
          className="w-full justify-between"
          value={[String(appearance.fill.preset)]}
          onValueChange={([preset]) =>
            preset && changeFill({ ...appearance.fill, preset: Number(preset) })
          }
        >
          {presets.map((_, preset) => (
            <ToggleGroupItem
              key={preset}
              value={String(preset)}
              aria-label={`Preset ${preset + 1}`}
              className="size-6 min-w-6 rounded-full p-0 aria-pressed:swatch-ring"
              style={{ background: fillCss({ ...appearance.fill, preset }) }}
            />
          ))}
        </ToggleGroup>
      </Section>
      {SECTIONS.map(({ title, amounts }) => (
        <Section key={title} title={title}>
          {amounts.map((amount) => (
            <ValueField key={amount} amount={amount} edits={edits} />
          ))}
        </Section>
      ))}
      <Section title="Border">
        <ValueField amount="borderWidth" edits={edits} />
        <Select
          value={appearance.borderColor}
          onValueChange={(borderColor) =>
            borderColor &&
            edits.change((project) =>
              changeAppearance(project, { borderColor }),
            )
          }
        >
          <SelectTrigger className="h-8 w-full rounded-md border-hairline bg-secondary px-3 text-caption">
            <span>Color</span>
            <SelectValue className="justify-end">
              {(value: BorderColor) => BORDER_COLORS[value].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BORDER_COLORS) as BorderColor[]).map((color) => (
              <SelectItem key={color} value={color}>
                {BORDER_COLORS[color].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>
      <div className="mt-auto p-3">
        <Button
          variant="secondary"
          className="w-full text-ui"
          onClick={() => edits.change(() => NEW_PROJECT)}
        >
          Reset all
        </Button>
      </div>
    </>
  );
}

function ValueField({ amount, edits }: { amount: Amount; edits: Edits }) {
  const { label, max, unit } = AMOUNTS[amount];
  const value = edits.project.appearance[amount];
  return (
    <Slider
      variant="field"
      max={max}
      value={[value]}
      onValueChange={(next) =>
        edits.preview((project) =>
          changeAppearance(project, { [amount]: Number(next) }),
        )
      }
      onValueCommitted={edits.commit}
    >
      <span>{label}</span>
      <span className="font-mono font-medium">
        {value} {unit}
      </span>
    </Slider>
  );
}
