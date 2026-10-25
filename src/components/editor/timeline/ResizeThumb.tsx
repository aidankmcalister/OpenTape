import { useState, type PointerEvent } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function ResizeThumb({
  draggingPx,
  thumbProps,
}: {
  draggingPx: number | null;
  thumbProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onDoubleClick: () => void;
  };
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDragging = draggingPx !== null;
  return (
    <div className="relative h-2 shrink-0">
      <Tooltip open={isHovered || isDragging} onOpenChange={setIsHovered}>
        <TooltipTrigger
          render={<div />}
          aria-label="Resize the timeline"
          data-dragging={isDragging}
          className="group absolute inset-x-0 -inset-y-1 z-10 grid cursor-row-resize place-items-center"
          {...thumbProps}
        >
          <span className="h-1 w-10 rounded-full bg-faint transition-colors group-hover:bg-muted-foreground group-data-[dragging=true]:bg-highlight" />
        </TooltipTrigger>
        <TooltipContent>
          {isDragging ? (
            <>
              <span className="font-mono font-semibold">{draggingPx}px</span>
              <span className="text-muted-foreground">timeline</span>
            </>
          ) : (
            <>
              <span className="font-semibold">Drag to resize</span>
              <span className="text-muted-foreground">
                Double-click to reset
              </span>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
