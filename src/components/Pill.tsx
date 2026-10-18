import type { ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** The glass bar every capture control sits on: the record bar, the overlay pills and the Area bar. */
export default function Pill({
  className,
  translucent = false,
  ...props
}: ComponentProps<"div"> & { translucent?: boolean }) {
  return (
    <div
      className={cn(
        "flex w-max items-center gap-1 rounded-full border border-glass-border p-2 text-[13px] font-medium text-foreground",
        translucent ? "bg-glass" : "bg-glass-solid",
        className,
      )}
      {...props}
    />
  );
}

/** A control inside a pill: modes, devices, ratios, the close button. */
export const pillItem = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      size: { default: "h-10 px-4", sm: "h-8 px-3", icon: "size-10" },
      active: {
        true: "bg-highlight/16 text-highlight-foreground",
        false: "text-muted-foreground hover:bg-white/8 hover:text-foreground",
      },
    },
    defaultVariants: { size: "default", active: false },
  },
);

export function PillDivider({ size = "default" }: { size?: "default" | "sm" }) {
  return (
    <Separator
      orientation="vertical"
      className={cn(
        "mx-1 bg-glass-border data-vertical:self-center",
        size === "sm" ? "h-4" : "h-6",
      )}
    />
  );
}
