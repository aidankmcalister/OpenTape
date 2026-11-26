import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import Pill from "@/components/Pill";
import { type Rect, rectStyle, type Size } from "@/lib/geometry";
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

/** Dims everything but `rect`, with its corners rounded like the window inside it. */
export function DimOutside({ rect }: { rect: Rect & { corner?: number } }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute dim-outside"
        style={{ ...rectStyle(rect), borderRadius: rect.corner ?? 0 }}
      />
    </div>
  );
}
