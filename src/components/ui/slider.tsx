import type { ReactNode } from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

const PARTS = {
  default: {
    track:
      "h-1 w-full rounded-full bg-muted data-vertical:h-full data-vertical:w-1",
    indicator: "bg-primary",
    thumb:
      "size-3 rounded-full border border-ring bg-white ring-ring/50 hover:ring-3 focus-visible:ring-3 active:ring-3",
  },
  field: {
    track: "h-1 w-full rounded-full bg-accent",
    indicator: "rounded-full bg-highlight",
    thumb:
      "size-4 rounded-full bg-primary-foreground shadow-md hover:ring-4 hover:ring-highlight/25 focus-visible:ring-4 focus-visible:ring-highlight/50 data-dragging:ring-4 data-dragging:ring-highlight/25",
  },
  hue: {
    track:
      "h-4 w-full rounded-full bg-[linear-gradient(to_right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)]",
    indicator: "bg-transparent",
    thumb:
      "size-4 rounded-full border-2 border-primary-foreground shadow-md focus-visible:ring-2 focus-visible:ring-ring",
  },
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  variant = "default",
  children,
  ...props
}: SliderPrimitive.Root.Props & {
  variant?: keyof typeof PARTS
  children?: ReactNode
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]
  const parts = PARTS[variant]

  return (
    <SliderPrimitive.Root
      className={cn("flex flex-col gap-2 data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      {children ? (
        <div className="flex h-5 items-center justify-between text-label">
          {children}
        </div>
      ) : null}
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden select-none",
            parts.track
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "select-none data-horizontal:h-full data-vertical:w-full",
              parts.indicator
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={cn(
              "relative block shrink-0 transition-[color,box-shadow] select-none after:absolute after:-inset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
              parts.thumb
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
