import type { CSSProperties } from "react";
import {
  Captions,
  Droplet,
  FastForward,
  Highlighter,
  type LucideIcon,
  MousePointerClick,
  Pencil,
  Type,
  ZoomIn,
} from "lucide-react";
import { REGIONS, type RegionKind } from "@/lib/editor/regions";
import { cn } from "@/lib/utils";

export const REGION_ICONS: Record<RegionKind, LucideIcon> = {
  zoom: ZoomIn,
  speed: FastForward,
  captions: Captions,
  annotation: Pencil,
  blur: Droplet,
  highlight: Highlighter,
  clickRing: MousePointerClick,
  titleCard: Type,
};

export function hueOf(kind: RegionKind) {
  return { "--hue": REGIONS[kind].hue } as CSSProperties;
}

export function KindTile({
  kind,
  className,
}: {
  kind: RegionKind;
  className?: string;
}) {
  const Icon = REGION_ICONS[kind];
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md bg-hue-fill text-hue-foreground [&_svg]:size-4",
        className,
      )}
      style={hueOf(kind)}
    >
      <Icon />
    </span>
  );
}
