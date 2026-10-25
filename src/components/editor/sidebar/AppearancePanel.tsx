import { Blend, Image, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsIconTrigger, TabsList } from "@/components/ui/tabs";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  clampAmount,
  COLORS,
  DEFAULT_APPEARANCE,
  fillCss,
  GRADIENTS,
  type Amount,
  type Fill,
} from "@/lib/editor/appearance";
import { NEW_PROJECT } from "@/lib/editor/project";
import { ColorSwatches } from "../ColorPicker";
import { PanelHeader, Section, ValueInput } from "../Panel";
import FillPicker from "./FillPicker";

const FILLS: { kind: Fill["kind"]; label: string; Icon: typeof Blend }[] = [
  { kind: "gradient", label: "Gradient", Icon: Blend },
  { kind: "color", label: "Color", Icon: Palette },
  { kind: "image", label: "Image", Icon: Image },
];

const BORDER_OPTIONS = COLORS.map((color, index) => ({
  value: color,
  color,
  label: `Border color ${index + 1}`,
}));

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
  const changeFill = (fill: Fill) => edits.setAppearance({ fill });
  return (
    <>
      <PanelHeader
        title="Background"
        onReset={() => edits.setAppearance(DEFAULT_APPEARANCE)}
      />
      <Section title="Fill">
        <Tabs
          value={appearance.fill.kind}
          onValueChange={(kind: Fill["kind"]) =>
            changeFill({ ...appearance.fill, kind })
          }
        >
          <TabsList variant="expand" className="w-full">
            {FILLS.map(({ kind, label, Icon }) => (
              <TabsIconTrigger
                key={kind}
                value={kind}
                icon={<Icon />}
                label={label}
                disabled={kind === "image"}
              />
            ))}
          </TabsList>
        </Tabs>
        <ColorSwatches
          options={presets.map((_, preset) => ({
            value: String(preset),
            label: `Preset ${preset + 1}`,
            color: fillCss({ ...appearance.fill, preset }),
          }))}
          value={String(appearance.fill.preset)}
          onChange={(preset) =>
            changeFill({ ...appearance.fill, preset: Number(preset) })
          }
          custom={<FillPicker edits={edits} />}
        />
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
        <ValueField amount="borderOpacity" edits={edits} />
        <ColorSwatches
          options={BORDER_OPTIONS}
          value={appearance.borderColor}
          onChange={(borderColor) => edits.setAppearance({ borderColor })}
          onPreview={(borderColor) =>
            edits.setAppearance({ borderColor }, true)
          }
          onCommit={edits.commit}
        />
      </Section>
      <div className="mt-auto p-3">
        <Button
          variant="secondary"
          className="w-full"
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
      max={max}
      value={[value]}
      onValueChange={(next) =>
        edits.setAppearance({ [amount]: Number(next) }, true)
      }
      onValueCommitted={edits.commit}
    >
      <span>{label}</span>
      <ValueInput
        label={label}
        value={value}
        unit={unit}
        onChange={(next) =>
          edits.setAppearance({ [amount]: clampAmount(amount, next) })
        }
      />
    </Slider>
  );
}
