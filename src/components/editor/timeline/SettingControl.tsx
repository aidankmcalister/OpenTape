import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { badgeCaps, MODIFIER_CAPS } from "@/lib/editor/keys";
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
    case "shortcut":
      return (
        <div className="flex flex-col gap-1.5">
          <LabeledRow label={setting.label}>
            <ShortcutField
              label={setting.label}
              value={String(value)}
              onChange={(next, isPreview) =>
                onChange(setting.key, next, isPreview)
              }
              onCommit={onCommit}
            />
          </LabeledRow>
          <p className="text-label text-muted-foreground">
            Pick the modifiers, then type the key, like <Kbd>K</Kbd> or{" "}
            <Kbd>Esc</Kbd>.
          </p>
        </div>
      );
    case "menu":
      return (
        <LabeledRow label={setting.label}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-between font-normal"
                />
              }
            >
              {String(value)}
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={String(value)}
                onValueChange={(next) => onChange(setting.key, String(next))}
              >
                {setting.options.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {option}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </LabeledRow>
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

/** Toggles for ⌃ ⌥ ⇧ ⌘, which are hard to type, and a box for the key itself. */
function ShortcutField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (value: string, isPreview?: boolean) => void;
  onCommit: () => void;
}) {
  const caps = badgeCaps(value);
  const held = caps.filter((cap) => MODIFIER_CAPS.includes(cap));
  const key = caps.filter((cap) => !MODIFIER_CAPS.includes(cap)).join("");
  const join = (modifiers: string[], typed: string) =>
    MODIFIER_CAPS.filter((cap) => modifiers.includes(cap)).join("") + typed;
  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        multiple
        spacing={0.5}
        aria-label="Modifiers"
        value={held}
        onValueChange={(next) => onChange(join(next, key))}
      >
        {MODIFIER_CAPS.map((cap) => (
          <ToggleGroupItem
            key={cap}
            value={cap}
            size="icon-sm"
            aria-label={cap}
          >
            {cap}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Input
        value={key}
        aria-label={`${label} key`}
        className="h-7 min-w-0 flex-1"
        onChange={(event) => onChange(join(held, event.target.value), true)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function Help({
  text,
  children,
}: {
  text?: ReactNode;
  children: string;
}) {
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
