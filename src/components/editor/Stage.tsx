import type { ComponentProps } from "react";
import Island from "./Island";

/** The recording, as big as the window allows. Takes any `<video>` prop. */
export default function Stage(props: ComponentProps<"video">) {
  return (
    <Island className="min-h-0 flex-1 bg-canvas">
      <video className="size-full object-contain" {...props} />
    </Island>
  );
}
