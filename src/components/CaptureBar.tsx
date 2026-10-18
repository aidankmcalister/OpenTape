import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useGlass } from "@/hooks/useGlass";
import type { Size } from "@/lib/geometry";
import Pill from "./Pill";

/**
 * The bar for every capture mode: what will be recorded, its size in pixels, an optional
 * control like the Area's ratio chip, and Record. It sits on Rust's frosted glass, so the apps
 * behind it blur. Compact drops the name and size, so the bar fits small windows.
 */
export default function CaptureBar({
  icon,
  title,
  size,
  control,
  isCompact = false,
  onRecord,
}: {
  /** A `CaptureTile`. */
  icon: ReactNode;
  title: string;
  size: Size;
  control?: ReactNode;
  isCompact?: boolean;
  onRecord: () => void;
}) {
  const glass = useGlass<HTMLDivElement>();
  return (
    <Pill
      ref={glass}
      translucent
      className="cursor-default gap-3 pl-3 shadow-pill"
    >
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

/** What's being recorded, as a 40px tile: a window's app icon, or an icon for the mode. */
export function CaptureTile({
  src,
  children,
}: {
  /** An app's icon, which fills the tile. */
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
