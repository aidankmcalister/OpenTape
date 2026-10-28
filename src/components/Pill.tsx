import { type ComponentProps, type ReactNode, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { useMorph } from "@/hooks/useMorph";
import type { Animation } from "@/lib/bindings";
import type { Size } from "@/lib/geometry";
import { cn } from "@/lib/utils";

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
            "absolute top-0 left-1/2 flex w-max -translate-x-1/2 items-center will-change-[opacity,scale,filter,translate] morph-hidden data-[active=true]:morph-shown",
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

export function MorphLabel({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [texts, setTexts] = useState([text]);
  const last = texts[texts.length - 1];
  if (last !== text) setTexts([last, text]);
  const morph = useMorph(text, undefined, 0);
  return (
    <span
      className="relative block shrink-0 overflow-x-clip"
      style={morph.pillStyle}
      data-morph-width={morph.pillStyle?.width}
    >
      {texts.map((shown) => (
        <span
          key={shown}
          className={cn(
            "absolute top-0 left-1/2 w-max -translate-x-1/2 morph-hidden data-[active=true]:morph-shown",
            !morph.pillStyle && "relative",
            className,
          )}
          {...morph.layerProps(shown)}
        >
          {shown}
        </span>
      ))}
    </span>
  );
}
