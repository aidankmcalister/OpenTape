import type { ReactNode } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  AMOUNTS,
  COLORS,
  fillCss,
  GRADIENTS,
  type Amount,
  type Fill,
} from "./edits";
import type { Editor } from "./useEditor";

const FILL_KINDS: { kind: Fill["kind"]; label: string; isReady: boolean }[] = [
  { kind: "gradient", label: "Gradient", isReady: true },
  { kind: "color", label: "Color", isReady: true },
  { kind: "image", label: "Image", isReady: false },
];

export default function BackgroundPanel({ editor }: { editor: Editor }) {
  const { resetLook } = editor;
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-3">
        <h2 className="text-base font-semibold tracking-[-0.01em]">
          Background
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reset background"
          onClick={resetLook}
        >
          <RotateCcw />
        </Button>
      </div>

      <Heading isFirst>Fill</Heading>
      <FillChoice editor={editor} />

      <Heading>Frame</Heading>
      <AmountBar editor={editor} amount="padding" />
      <AmountBar editor={editor} amount="radius" />
      <AmountBar editor={editor} amount="inset" />

      <Heading>Shadow</Heading>
      <AmountBar editor={editor} amount="shadowOpacity" />
      <AmountBar editor={editor} amount="shadowBlur" />
      <AmountBar editor={editor} amount="shadowOffsetY" />

      <Heading>Border</Heading>
      <AmountBar editor={editor} amount="borderWidth" />
      <div className="px-3 py-1">
        <Button variant="outline" disabled className="w-full justify-between">
          Color
          <span className="flex items-center gap-1 font-mono">
            White
            <ChevronDown />
          </span>
        </Button>
      </div>

      <div className="mt-auto px-3 py-3">
        <Button
          variant="outline"
          size="pill-sm"
          onClick={resetLook}
          className="w-full"
        >
          Reset all
        </Button>
      </div>
    </section>
  );
}

function FillChoice({ editor }: { editor: Editor }) {
  const { look, setFill } = editor;
  const presets = look.fill.kind === "color" ? COLORS : GRADIENTS;
  return (
    <>
      <div className="px-3 py-2">
        <ToggleGroup
          variant="segment"
          size="sm"
          spacing={0}
          value={[look.fill.kind]}
          onValueChange={([chosen]) => {
            const kind = FILL_KINDS.find((fill) => fill.kind === chosen)?.kind;
            if (kind) setFill({ ...look.fill, kind });
          }}
          className="w-full rounded-2xl border border-hairline bg-background p-px"
        >
          {FILL_KINDS.map(({ kind, label, isReady }) => (
            <ToggleGroupItem
              key={kind}
              value={kind}
              disabled={!isReady}
              className="flex-1 rounded-xl!"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="px-3 py-1 text-xs font-medium text-faint">Presets</p>
      <ToggleGroup
        value={[String(look.fill.preset)]}
        onValueChange={([preset]) =>
          preset && setFill({ ...look.fill, preset: Number(preset) })
        }
        className="px-3 py-2"
      >
        {presets.map((_, preset) => (
          <ToggleGroupItem
            key={preset}
            value={String(preset)}
            aria-label={`Preset ${preset + 1}`}
            className="size-6 min-w-6 rounded-full border border-glass-border p-0 outline-offset-2 outline-highlight aria-pressed:outline-2 aria-pressed:outline-solid"
            style={{ background: fillCss({ ...look.fill, preset }) }}
          />
        ))}
      </ToggleGroup>
    </>
  );
}

function Heading({
  children,
  isFirst,
}: {
  children: ReactNode;
  isFirst?: boolean;
}) {
  return (
    <h3
      className={cn(
        "shrink-0 px-3 pt-3.5 pb-1.5 text-ui font-semibold",
        !isFirst && "mt-2 border-t border-hairline",
      )}
    >
      {children}
    </h3>
  );
}

/** A slider drawn as a bar that fills to its value, with the label and value on top. */
function AmountBar({ editor, amount }: { editor: Editor; amount: Amount }) {
  const { label, max, unit } = AMOUNTS[amount];
  const value = editor.look[amount];
  const filled = `${(value / max) * 100}%`;
  return (
    <div className="px-3 py-1">
      <label className="relative flex h-8 items-center justify-between overflow-hidden rounded-lg border border-hairline bg-secondary px-[11px] text-xs">
        <span
          className="absolute inset-y-0 left-0 bg-highlight/20"
          style={{ width: filled }}
        />
        {value > 0 && (
          <span
            className="absolute inset-y-0 w-0.5 bg-highlight"
            style={{ left: filled }}
          />
        )}
        <span className="relative">{label}</span>
        <span className="relative font-mono font-medium">
          {value} {unit}
        </span>
        <input
          type="range"
          min={0}
          max={max}
          value={value}
          aria-label={label}
          onChange={(event) =>
            editor.setAmount(amount, Number(event.target.value))
          }
          className="absolute inset-0 cursor-ew-resize opacity-0"
        />
      </label>
    </div>
  );
}
