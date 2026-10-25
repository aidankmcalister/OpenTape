import type { ComponentProps, ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function PanelHeader({
  title,
  onReset,
}: {
  title: string;
  onReset?: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-3 hairline-b">
      <h2 className="text-heading font-semibold">{title}</h2>
      {onReset ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Reset ${title.toLowerCase()}`}
          onClick={onReset}
        >
          <RotateCcw />
        </Button>
      ) : null}
    </header>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-hairline p-3">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-ui font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Swatch({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupItem>) {
  return (
    <ToggleGroupItem
      className={cn(
        "size-6 min-w-6 rounded-full p-0 inset-ring inset-ring-hairline transition-[box-shadow] aria-pressed:swatch-ring",
        className,
      )}
      {...props}
    />
  );
}

export function NumberField({
  step,
  ...props
}: Parameters<typeof ValueInput>[0] & { step?: number }) {
  return (
    <div className="flex h-8 items-center gap-1 rounded-md bg-secondary pl-3 text-label inset-ring inset-ring-hairline has-[button]:pr-1 not-has-[button]:pr-3">
      <span className="mr-auto">{props.label}</span>
      <ValueInput {...props} />
      {step ? (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Less ${props.label.toLowerCase()}`}
            onClick={() => props.onChange(props.value - step)}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`More ${props.label.toLowerCase()}`}
            onClick={() => props.onChange(props.value + step)}
          >
            <Plus />
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function ValueInput({
  label,
  value,
  unit,
  onChange,
  format = (value) => String(Math.round(value * 100) / 100),
  parse = Number.parseFloat,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  parse?: (text: string) => number;
}) {
  const shown = format(value);
  return (
    <label className="-mr-1.5 inline-flex h-5 cursor-text items-center gap-1 rounded-md px-1.5 font-mono font-medium transition-colors hover:bg-accent focus-within:bg-background focus-within:ring-1 focus-within:ring-ring/60">
      <input
        key={shown}
        aria-label={label}
        inputMode="decimal"
        defaultValue={shown}
        style={{ width: `${Math.max(shown.length, 1)}ch` }}
        className="bg-transparent text-right outline-none"
        onFocus={(event) => event.currentTarget.select()}
        onInput={(event) => {
          const { style, value } = event.currentTarget;
          style.width = `${Math.max(value.length, 1)}ch`;
        }}
        onBlur={(event) => {
          const next = parse(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
          else event.currentTarget.value = shown;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.value = shown;
          if (event.key === "Enter" || event.key === "Escape")
            event.currentTarget.blur();
        }}
      />
      {unit ? <span className="text-muted-foreground">{unit}</span> : null}
    </label>
  );
}
