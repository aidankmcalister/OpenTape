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
