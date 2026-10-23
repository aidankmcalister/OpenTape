import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export default function Island({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-hairline bg-card",
        className,
      )}
      {...props}
    />
  );
}
