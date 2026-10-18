import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A rounded panel of the editor: the side panels, the stage and the timeline. */
export default function Island({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-hairline bg-island",
        className,
      )}
      {...props}
    />
  );
}
