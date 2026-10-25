import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverTitle } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  settingValue,
  type Region,
  type Setting,
  type SettingValue,
} from "@/lib/editor/regions";
import { MARK_COLORS, type MarkColor } from "@/lib/editor/appearance";
import { focusBox, focusCenter } from "@/lib/editor/zoom";
import { clamp } from "@/lib/geometry";
import ColorPicker, { CustomSwatch } from "../ColorPicker";
import { NumberField, SelectField, Swatch, ValueInput } from "../Panel";

type Edit = {
  region: Region;
  set: (key: string, value: SettingValue) => void;
  preview: (key: string, value: SettingValue) => void;
  change: (change: Partial<Region>) => void;
  commit: () => void;
};

export default function SettingControl({
  setting,
  edit,
}: {
  setting: Setting;
  edit: Edit;
}) {
  const { region, set } = edit;
  const value = (key: string) => settingValue(region, key);
  switch (setting.kind) {
    case "slider": {
      const { key, label, min, max, step, unit } = setting;
      return (
        <Slider
          min={min}
          max={max}
          step={step}
          value={[Number(value(key))]}
          onValueChange={(next) => edit.preview(key, Number(next))}
          onValueCommitted={edit.commit}
        >
          <span>{label}</span>
          <ValueInput
            label={label}
            value={Number(value(key))}
            unit={unit}
            onChange={(next) => set(key, clamp(next, min, max))}
          />
        </Slider>
      );
    }
    case "choice":
      return (
        <Row label={setting.label}>
          <Tabs
            value={String(value(setting.key))}
            onValueChange={(next: string) => set(setting.key, next)}
          >
            <TabsList className="w-full">
              {setting.options.map((option) => (
                <TabsTrigger
                  key={option}
                  value={option}
                  disabled={setting.disabled?.includes(option)}
                >
                  {option}
                  {setting.unit}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Row>
      );
    case "color": {
      const color = String(value(setting.key));
      const isCustom = !(color in MARK_COLORS);
      return (
        <Row label={setting.label}>
          <ToggleGroup
            spacing={1}
            className="w-full justify-between"
            value={[isCustom ? "custom" : color]}
            onValueChange={([next]) =>
              next && next !== "custom" && set(setting.key, next)
            }
          >
            {(Object.keys(MARK_COLORS) as MarkColor[]).map((mark) => (
              <Swatch
                key={mark}
                value={mark}
                aria-label={mark}
                style={{ background: MARK_COLORS[mark] }}
              />
            ))}
            <CustomSwatch fill={isCustom ? color : null}>
              <PopoverTitle>Custom color</PopoverTitle>
              <ColorPicker
                color={isCustom ? color : MARK_COLORS[color as MarkColor]}
                onPreview={(hex) => edit.preview(setting.key, hex)}
                onChange={(hex) => set(setting.key, hex)}
                onCommit={edit.commit}
              />
            </CustomSwatch>
          </ToggleGroup>
        </Row>
      );
    }
    case "switch":
      return (
        <label className="flex h-8 items-center justify-between text-label">
          {setting.label}
          <Switch
            checked={Boolean(value(setting.key))}
            onCheckedChange={(checked) => set(setting.key, checked)}
          />
        </label>
      );
    case "text":
      return (
        <Row label={setting.label}>
          <Input
            key={String(value(setting.key))}
            aria-label={setting.label}
            defaultValue={String(value(setting.key))}
            placeholder={setting.placeholder}
            onBlur={(event) => set(setting.key, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Row>
      );
    case "select":
      return (
        <SelectField
          label={setting.label}
          value={String(value(setting.key))}
          options={setting.options.map((option) => ({
            value: option,
            label: option,
          }))}
          onChange={(next) => set(setting.key, next)}
        />
      );
    case "seconds":
      return (
        <div className="grid grid-cols-2 gap-2">
          {setting.fields.map(({ key, label }) => (
            <NumberField
              key={key}
              label={label}
              value={Number(value(key))}
              unit="s"
              onChange={(seconds) => set(key, clamp(seconds, 0, 10))}
            />
          ))}
        </div>
      );
    case "focus":
      return <Focus edit={edit} />;
    case "action":
      return (
        <Button variant="secondary" className="w-full" disabled>
          {setting.label}
        </Button>
      );
    case "hint":
      return (
        <p className="text-label text-muted-foreground">
          {typeof setting.text === "string"
            ? setting.text
            : setting.text(region)}
        </p>
      );
  }
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return children;
  return (
    <div className="flex items-center">
      <span className="w-18 shrink-0 text-label text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Focus({ edit }: { edit: Edit }) {
  const center = focusCenter(edit.region);
  const box = focusBox(edit.region);
  const axes = ["x", "y"] as const;
  return (
    <div className="flex gap-2">
      <div className="relative h-18 w-32 shrink-0 overflow-hidden rounded-md bg-background inset-ring inset-ring-hairline">
        <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        <div
          className="absolute border border-dashed border-highlight/60"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.size * 100}%`,
            height: `${box.size * 100}%`,
          }}
        />
        <div
          className="absolute size-2 -translate-1/2 rounded-full bg-highlight"
          style={{
            left: `${(box.x + box.size / 2) * 100}%`,
            top: `${(box.y + box.size / 2) * 100}%`,
          }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {axes.map((axis) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            value={Math.round(center[axis] * 100)}
            unit="%"
            onChange={(percent) =>
              edit.change({
                center: { ...center, [axis]: clamp(percent / 100, 0, 1) },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
