import type { ComponentProps } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** The glass bar every capture control sits on: the record bar, the capture bars and the dock. */
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
