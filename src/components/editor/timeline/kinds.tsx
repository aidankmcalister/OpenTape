import { useSyncExternalStore, type CSSProperties } from "react";
import {
  Droplet,
  FastForward,
  Keyboard,
  type LucideIcon,
  ZoomIn,
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { badgeCaps } from "@/lib/editor/keys";
import { REGIONS, type RegionKind } from "@/lib/editor/regions";
import type { MeasureText } from "@/lib/editor/timeline";
import { cn } from "@/lib/utils";

export const REGION_ICONS: Record<RegionKind, LucideIcon> = {
  zoom: ZoomIn,
  speed: FastForward,
  blur: Droplet,
  keys: Keyboard,
};

export function hueOf(kind: RegionKind) {
  const { hue, text } = REGIONS[kind];
  return { "--hue": hue, "--hue-text": text } as CSSProperties;
}

const FONTS = {
  name: "600 12px system-ui, -apple-system, sans-serif",
  value: '600 12px "IBM Plex Mono", ui-monospace, monospace',
  cap: "500 10px system-ui, -apple-system, sans-serif",
};
const textWidths = new Map<string, number>();
let textContext: CanvasRenderingContext2D | null = null;
let fontsVersion = 0;

function subscribeFonts(onChange: () => void) {
  const bump = () => {
    fontsVersion += 1;
    onChange();
  };
  document.fonts.addEventListener("loadingdone", bump);
  return () => document.fonts.removeEventListener("loadingdone", bump);
}

/** Measures block text in its real fonts, measuring again as fonts load. */
export function useMeasureText(): MeasureText {
  useSyncExternalStore(subscribeFonts, () => fontsVersion);
  return measureText;
}

function measureText(text: string, font: keyof typeof FONTS): number {
  const key = `${font}:${text}`;
  const known = textWidths.get(key);
  if (known !== undefined) return known;
  textContext ??= document.createElement("canvas").getContext("2d");
  if (!textContext) return text.length * 7;
  textContext.font = FONTS[font];
  const width = Math.ceil(textContext.measureText(text).width);
  if (document.fonts.check(FONTS[font], text)) textWidths.set(key, width);
  return width;
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

/** A modifier's value: Kbd caps for Keys, mono text for the rest. */
export function RegionValue({
  kind,
  value,
  className,
  capClassName,
}: {
  kind: RegionKind;
  value: string;
  className?: string;
  capClassName?: string;
}) {
  if (!REGIONS[kind].showsKeycaps)
    return (
      <span className={cn("font-mono font-medium", className)}>{value}</span>
    );
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      {badgeCaps(value).map((cap, at) => (
        <Kbd
          key={at}
          className={cn("bg-hue/28 text-hue-foreground", capClassName)}
        >
          {cap}
        </Kbd>
      ))}
    </span>
  );
}
