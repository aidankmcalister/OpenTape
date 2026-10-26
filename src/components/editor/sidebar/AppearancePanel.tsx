import { Blend, Image, Palette } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsIconTrigger, TabsList } from "@/components/ui/tabs";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  clampAmount,
  COLORS,
  DEFAULT_APPEARANCE,
  fillCss,
  FRAME_SIZES,
  GRADIENTS,
  PRESET_NAMES,
  type Amount,
  type Fill,
  type FrameSize,
} from "@/lib/editor/appearance";
import { ColorSwatches } from "../ColorPicker";
import { Dim, PanelHeader, Section, ValueInput } from "../Panel";
import SettingControl from "../timeline/SettingControl";
import FillPicker from "./FillPicker";

const FILLS: { kind: Fill["kind"]; label: string; Icon: typeof Blend }[] = [
  { kind: "gradient", label: "Gradient", Icon: Blend },
  { kind: "color", label: "Color", Icon: Palette },
  { kind: "image", label: "Image", Icon: Image },
];

const BORDER_OPTIONS = COLORS.map((color, index) => ({
  value: color,
  color,
  label: PRESET_NAMES.color[index],
}));

export default function AppearancePanel({ edits }: { edits: Edits }) {
  const { appearance } = edits.project;
  const isColor = appearance.fill.kind === "color";
  const presets = isColor ? COLORS : GRADIENTS;
  const changeFill = (fill: Fill) => edits.setAppearance({ fill });
  return (
    <>
      <PanelHeader
        title="Background"
        onReset={() =>
          edits.setAppearance({
            ...DEFAULT_APPEARANCE,
            cursor: appearance.cursor,
          })
        }
      />
      <Section title="Size">
        <SettingControl
          setting={{
            kind: "choice",
            key: "size",
            options: Object.keys(FRAME_SIZES),
          }}
          edit={{
            value: () => appearance.size,
            set: (_, size) => edits.setAppearance({ size: size as FrameSize }),
            preview: () => {},
            commit: edits.commit,
          }}
        />
      </Section>
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
            label: PRESET_NAMES[isColor ? "color" : "gradient"][preset],
            color: fillCss({ ...appearance.fill, preset }),
          }))}
          value={String(appearance.fill.preset)}
          onChange={(preset) =>
            changeFill({ ...appearance.fill, preset: Number(preset) })
          }
          custom={<FillPicker edits={edits} />}
        />
      </Section>
      <Section title="Frame">
        <ValueField amount="padding" edits={edits} />
        <ValueField amount="radius" edits={edits} />
        <ValueField amount="inset" edits={edits} />
      </Section>
      <Section title="Shadow">
        <ValueField amount="shadowOpacity" edits={edits} />
        <Dim
          when={appearance.shadowOpacity === 0}
          className="flex flex-col gap-2"
        >
          <ValueField amount="shadowBlur" edits={edits} />
          <ValueField amount="shadowOffsetY" edits={edits} />
        </Dim>
      </Section>
      <Section title="Border">
        <ValueField amount="borderWidth" edits={edits} />
        {appearance.borderWidth > 0 ? (
          <>
            <ColorSwatches
              options={BORDER_OPTIONS}
              value={appearance.borderColor}
              onChange={(borderColor) => edits.setAppearance({ borderColor })}
              onPreview={(borderColor) =>
                edits.setAppearance({ borderColor }, true)
              }
              onCommit={edits.commit}
            />
            <ValueField amount="borderOpacity" edits={edits} />
          </>
        ) : null}
      </Section>
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
