import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-4 w-fit min-w-4 items-center justify-center gap-0.5 rounded-[4px] bg-accent px-1 font-sans text-micro leading-none font-medium text-muted-foreground select-none in-[[data-slot=button][data-variant=default]]:bg-primary-tint-foreground/15 in-[[data-slot=button][data-variant=default]]:text-primary-tint-foreground/80 in-[[data-slot=button][data-variant=primary]]:bg-primary-foreground/20 in-[[data-slot=button][data-variant=primary]]:text-primary-foreground [&_svg:not([class*='size-'])]:size-2.5",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
