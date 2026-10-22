import type { ComponentProps } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import { DEFAULT_LOOK, fillCss, frameLayout } from "@/lib/editor/edits";
import Island from "./Island";

/** The recording in the default look: on a background, with padding, rounded corners and a shadow. Takes any `<video>` prop, plus the video's `ratio`. */
export default function Stage({
  ratio,
  ...props
}: ComponentProps<"video"> & { ratio: number }) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { frame, recording, radius, shadow } = frameLayout(
    DEFAULT_LOOK,
    size,
    ratio,
  );
  return (
    <Island className="min-h-0 flex-1 bg-canvas">
      <div ref={ref} className="grid size-full place-items-center">
        <div
          className="grid place-items-center rounded-lg shadow-stage"
          style={{ ...frame, background: fillCss(DEFAULT_LOOK.fill) }}
        >
          <div
            className="overflow-hidden"
            style={{
              ...recording,
              borderRadius: radius,
              boxShadow: `0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`,
            }}
          >
            <video className="size-full object-cover" {...props} />
          </div>
        </div>
      </div>
    </Island>
  );
}
