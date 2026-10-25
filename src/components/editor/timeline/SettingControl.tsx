import type { ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type Region,
  type Setting,
  type SettingValue,
} from "@/lib/editor/regions";
import { MARK_COLORS, type MarkColor } from "@/lib/editor/appearance";
import { focusBox, focusBoxStyle, focusCenter } from "@/lib/editor/zoom";
import { clamp } from "@/lib/geometry";
import { ColorSwatches } from "../ColorPicker";
import { NumberField, ValueInput, SwitchField } from "../Panel";

const MARK_OPTIONS = (Object.keys(MARK_COLORS) as MarkColor[]).map((mark) => ({
  value: mark,
  color: MARK_COLORS[mark],
  label: mark,
}));

type Edit = {
  value: (key: string) => SettingValue;
  set: (key: string, value: SettingValue) => void;
  preview: (key: string, value: SettingValue) => void;
  commit: () => void;
  region?: Region;
  change?: (change: Partial<Region>) => void;
};

export default function SettingControl({
  setting,
  edit,
}: {
  setting: Setting;
  edit: Edit;
}) {
  const { region, set, value } = edit;
  switch (setting.kind) {
    case "slider": {
      const { key, label, min, max, step, unit, help, onlyWith } = setting;
      if (onlyWith && !value(onlyWith)) return null;
      return (
        <Slider
          min={min}
          max={max}
          step={step}
          value={[Number(value(key))]}
          onValueChange={(next) => edit.preview(key, Number(next))}
          onValueCommitted={edit.commit}
        >
          <Help text={help}>{label}</Help>
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
                  className="text-label"
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
    case "color":
      return (
        <Row label={setting.label}>
          <ColorSwatches
            options={MARK_OPTIONS}
            value={String(value(setting.key))}
            onChange={(color) => set(setting.key, color)}
            onPreview={(color) => edit.preview(setting.key, color)}
            onCommit={edit.commit}
          />
        </Row>
      );
    case "switch":
      return (
        <SwitchField
          label={<Help text={setting.help}>{setting.label}</Help>}
          checked={Boolean(value(setting.key))}
          onChange={(checked) => set(setting.key, checked)}
        />
      );
    case "focus":
      return region && edit.change ? (
        <Focus region={region} change={edit.change} />
      ) : null;
    case "hint":
      return (
        <p className="text-label text-muted-foreground">
          {typeof setting.text === "string"
            ? setting.text
            : region && setting.text(region)}
        </p>
      );
  }
}

function Help({ text, children }: { text?: string; children: string }) {
  if (!text) return <span>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="h-auto max-w-64 py-1.5 leading-4"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
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

function Focus({
  region,
  change,
}: {
  region: Region;
  change: (change: Partial<Region>) => void;
}) {
  const center = focusCenter(region);
  const box = focusBox(region);
  const axes = ["x", "y"] as const;
  return (
    <div className="flex gap-2">
      <div className="relative h-18 w-32 shrink-0 overflow-hidden rounded-md bg-background inset-ring inset-ring-hairline">
        <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        <div
          className="absolute border border-dashed border-highlight/60"
          style={focusBoxStyle(region)}
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
              change({
                center: { ...center, [axis]: clamp(percent / 100, 0, 1) },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
