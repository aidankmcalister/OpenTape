import type { ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  initialOf,
  type Region,
  type Setting,
  type SettingValue,
} from "@/lib/editor/regions";
import { MARK_COLORS, type MarkColor } from "@/lib/editor/appearance";
import { focusBox, focusCenter } from "@/lib/editor/zoom";
import { clamp, percentStyle, type Point } from "@/lib/geometry";
import { ColorSwatches } from "../ColorPicker";
import { Dim, NumberField, ValueInput, SwitchField } from "../Panel";

const MARK_OPTIONS = (Object.keys(MARK_COLORS) as MarkColor[]).map((mark) => ({
  value: mark,
  color: MARK_COLORS[mark],
  label: mark,
}));

export default function SettingControl({
  setting,
  values,
  onChange,
  onCommit,
  region,
  crop,
  onCenter,
}: {
  setting: Setting;
  values: Record<string, unknown>;
  onChange: (key: string, value: SettingValue, isPreview?: boolean) => void;
  onCommit: () => void;
  region?: Region;
  crop?: Point;
  onCenter?: (center: Point) => void;
}) {
  const value = (("key" in setting ? values[setting.key] : null) ??
    initialOf(setting)) as SettingValue;
  switch (setting.kind) {
    case "slider": {
      const { key, label, min, max, step, unit, help } = setting;
      return (
        <Slider
          min={min}
          max={max}
          step={step}
          value={[Number(value)]}
          onValueChange={(next) => onChange(key, Number(next), true)}
          onValueCommitted={onCommit}
        >
          <Help text={help}>{label}</Help>
          <ValueInput
            label={label}
            value={Number(value)}
            unit={unit}
            onChange={(next) =>
              onChange(
                key,
                clamp(
                  Number.isInteger(step) ? Math.round(next) : next,
                  min,
                  max,
                ),
              )
            }
          />
        </Slider>
      );
    }
    case "choice":
      return (
        <LabeledRow label={setting.label}>
          <Tabs
            value={String(value)}
            onValueChange={(next: string) => onChange(setting.key, next)}
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
        </LabeledRow>
      );
    case "color":
      return (
        <LabeledRow label={setting.label}>
          <ColorSwatches
            options={MARK_OPTIONS}
            value={String(value)}
            onChange={(color) => onChange(setting.key, color)}
            onPreview={(color) => onChange(setting.key, color, true)}
            onCommit={onCommit}
          />
        </LabeledRow>
      );
    case "switch":
      return (
        <SwitchField
          label={<Help text={setting.help}>{setting.label}</Help>}
          checked={Boolean(value)}
          onChange={(checked) => onChange(setting.key, checked)}
        />
      );
    case "focus":
      return region && onCenter ? (
        <Dim when={values.focus === "Follow cursor"}>
          <Focus region={region} crop={crop} onCenter={onCenter} />
        </Dim>
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

export function Help({ text, children }: { text?: string; children: string }) {
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

function LabeledRow({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
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
  crop,
  onCenter,
}: {
  region: Region;
  crop?: Point;
  onCenter: (center: Point) => void;
}) {
  const center = focusCenter(region);
  const box = focusBox(region, crop);
  const axes = ["x", "y"] as const;
  return (
    <div className="flex gap-2">
      <div className="relative h-18 w-32 shrink-0 overflow-hidden rounded-md bg-background inset-ring inset-ring-hairline">
        <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        <div
          className="absolute border border-dashed border-highlight/60"
          style={percentStyle(box)}
        />
        <div
          className="absolute size-2 -translate-1/2 rounded-full bg-highlight"
          style={{
            left: `${(box.x + box.width / 2) * 100}%`,
            top: `${(box.y + box.height / 2) * 100}%`,
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
              onCenter({ ...center, [axis]: clamp(percent / 100, 0, 1) })
            }
          />
        ))}
      </div>
    </div>
  );
}
