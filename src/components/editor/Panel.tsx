import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PanelHeader({
  title,
  onReset,
}: {
  title: string;
  onReset?: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-3">
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

export function ValueInput({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const shown = String(Math.round(value * 100) / 100);
  return (
    <span className="flex items-baseline gap-1 font-mono font-medium">
      <input
        key={shown}
        aria-label={label}
        inputMode="decimal"
        defaultValue={shown}
        className="w-[5ch] rounded-sm bg-transparent text-right outline-none hover:bg-accent focus:bg-accent focus:text-highlight-foreground"
        onBlur={(event) => {
          const next = Number.parseFloat(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
          else event.currentTarget.value = shown;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.value = shown;
          if (event.key === "Enter" || event.key === "Escape")
            event.currentTarget.blur();
        }}
      />
      {unit}
    </span>
  );
}
