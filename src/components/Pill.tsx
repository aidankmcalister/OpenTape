import type { ComponentProps, ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { useMorph } from "@/hooks/useMorph";
import type { Animation } from "@/lib/bindings";
import type { Size } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/** The glass bar every capture control sits on. */
export default function Pill({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-max items-center gap-1 rounded-full border border-glass-border bg-glass p-2 text-ui font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PillDivider() {
  return (
    <Separator
      orientation="vertical"
      className="mx-1 h-6 bg-glass-border data-vertical:self-center"
    />
  );
}

/** A line of text on a pill, with an icon before it: what's going on, like "Saving…". */
export function PillMessage({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex h-8 items-center gap-2 px-3 text-ui font-medium [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      {children}
    </span>
  );
}

/**
 * A pill that morphs between states of different widths. Each state keeps its own GPU layer the
 * whole time, so WebKit never redraws its text mid-animation and snaps it back, which reads as a
 * shake.
 */
export function MorphPill<Key extends string>({
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
