import type { ComponentProps, ReactNode } from "react";
import { useMorph } from "@/hooks/useMorph";
import type { Animation } from "@/lib/bindings/Animation";
import type { Size } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import Pill from "./Pill";

/**
 * A pill that morphs between states of different widths: the width glides, the leaving state
 * shrinks and blurs away, and the arriving one settles in just after. Each state keeps its own
 * GPU layer the whole time, so WebKit never redraws its text mid-animation and snaps it back,
 * which would read as a shake.
 */
export default function MorphPill<Key extends string>({
  active,
  layers,
  onShape,
  layerClassName,
  isDragRegion = false,
  className,
  ...props
}: {
  active: Key;
  /** Every state, mounted at once so each can be measured. */
  layers: Record<Key, ReactNode>;
  onShape?: (size: Size, animation: Animation | null) => void;
  layerClassName?: string;
  /** Whether the pill and its states drag the window, like the record bar. */
  isDragRegion?: boolean;
} & ComponentProps<typeof Pill>) {
  const morph = useMorph(active, onShape);
  const dragRegion = isDragRegion ? { "data-tauri-drag-region": true } : {};
  return (
    <Pill
      {...dragRegion}
      className={cn("relative block shrink-0 overflow-x-clip p-0", className)}
      style={morph.pillStyle}
      {...props}
    >
      {(Object.keys(layers) as Key[]).map((key) => (
        <div
          key={key}
          {...dragRegion}
          className={cn(
            "absolute top-0 left-1/2 flex w-max -translate-x-1/2 items-center ease-out will-change-[opacity,scale,filter,translate] motion-reduce:transition-none",
            "transition-[opacity,scale,filter] data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:blur-xs data-[active=false]:duration-150 data-[active=true]:delay-100 data-[active=true]:duration-300",
            layerClassName,
          )}
          {...morph.layerProps(key)}
        >
          {layers[key]}
        </div>
      ))}
    </Pill>
  );
}
