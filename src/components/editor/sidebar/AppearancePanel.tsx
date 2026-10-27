import { Blend, Image, Palette, Wallpaper } from "lucide-react";
import { Tabs, TabsIconTrigger, TabsList } from "@/components/ui/tabs";
import type { Edits } from "@/hooks/editor/useProject";
import {
  AMOUNTS,
  COLORS,
  DEFAULT_APPEARANCE,
  fillCss,
  FRAME_FITS,
  FRAME_SIZES,
  GRADIENTS,
  PRESET_NAMES,
  type Fill,
} from "@/lib/editor/appearance";
import type { SettingValue } from "@/lib/editor/regions";
import { ColorSwatches } from "../ColorPicker";
import { Dim, PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";
import FillPicker, { ImageDrop } from "./FillPicker";

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
  const control = {
    values: appearance,
    onChange: (key: string, value: SettingValue, isPreview?: boolean) =>
      edits.setAppearance({ [key]: value }, isPreview),
    onCommit: edits.commit,
  };
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
              />
            ))}
            <TabsIconTrigger
              value="wallpaper"
              icon={<Wallpaper />}
              label="Wallpapers"
              disabled
            />
          </TabsList>
        </Tabs>
        {appearance.fill.kind === "image" ? (
          <ImageDrop
            onAdded={(image) => changeFill({ ...appearance.fill, image })}
          />
        ) : (
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
        )}
      </Section>
      <Section title="Size">
        <SettingControl
          setting={{
            kind: "choice",
            key: "size",
            options: Object.keys(FRAME_SIZES),
          }}
          {...control}
        />
        {appearance.size !== "Auto" ? (
          <SettingControl
            setting={{ kind: "choice", key: "fit", options: FRAME_FITS }}
            {...control}
          />
        ) : null}
      </Section>
      <Section title="Frame">
        <SettingControl setting={AMOUNTS.padding} {...control} />
        <SettingControl setting={AMOUNTS.radius} {...control} />
        <SettingControl setting={AMOUNTS.inset} {...control} />
      </Section>
      <Section title="Shadow">
        <SettingControl setting={AMOUNTS.shadowOpacity} {...control} />
        <Dim
          when={appearance.shadowOpacity === 0}
          className="flex flex-col gap-2"
        >
          <SettingControl setting={AMOUNTS.shadowBlur} {...control} />
          <SettingControl setting={AMOUNTS.shadowOffsetY} {...control} />
        </Dim>
      </Section>
      <Section title="Border">
        <SettingControl setting={AMOUNTS.borderWidth} {...control} />
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
            <SettingControl setting={AMOUNTS.borderOpacity} {...control} />
          </>
        ) : null}
      </Section>
    </>
  );
}
