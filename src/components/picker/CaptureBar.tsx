import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import Pill from "@/components/Pill";
import type { Rect, Size } from "@/lib/geometry";
import { useGlass } from "@/hooks/picker/usePicker";

export default function CaptureBar({
  icon,
  title,
  size,
  control,
  isCompact = false,
  onRecord,
}: {
  icon: ReactNode;
  title: string;
  size: Size;
  control?: ReactNode;
  isCompact?: boolean;
  onRecord: () => void;
}) {
  const glass = useGlass<HTMLDivElement>();
  return (
    <Pill ref={glass} className="cursor-default gap-3 pl-3 shadow-pill">
      {icon}
      {!isCompact && (
        <div className="shrink-0 pr-1">
          <p className="leading-5 text-foreground">{title}</p>
          <p className="font-mono text-xs leading-4 font-normal whitespace-nowrap text-muted-foreground tabular-nums">
            {size.width} × {size.height}
          </p>
        </div>
      )}
      {control}
      <Button size="pill" onClick={onRecord}>
        <span className="size-2 rounded-full bg-current" />
        Record
      </Button>
    </Pill>
  );
}

export function CaptureTile({
  src,
  children,
}: {
  src?: string | null;
  children?: ReactNode;
}) {
  if (src) return <img src={src} alt="" className="size-10 shrink-0" />;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground [&_svg]:size-4">
      {children}
    </span>
  );
}

export function DimOutside({ rect }: { rect: Rect }) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return (
    <>
      <div
        className="fixed inset-x-0 top-0 bg-dim"
        style={{ height: Math.max(rect.y, 0) }}
      />
      <div
        className="fixed inset-x-0 bottom-0 bg-dim"
        style={{ top: bottom }}
      />
      <div
        className="fixed left-0 bg-dim"
        style={{ top: rect.y, height: rect.height, width: Math.max(rect.x, 0) }}
      />
      <div
        className="fixed right-0 bg-dim"
        style={{ top: rect.y, height: rect.height, left: right }}
      />
    </>
  );
}

export function Countdown({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <CountdownPill value={value} />
    </div>
  );
}

function CountdownPill({ value }: { value: number }) {
  const glass = useGlass<HTMLDivElement>();
  return (
    <Pill
      ref={glass}
      className="size-28 justify-center p-0 font-heading text-6xl font-semibold tabular-nums shadow-pill"
    >
      {value}
    </Pill>
  );
}
