import { FastForward, Plus, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { REGIONS, type RegionKind } from "@/features/editor/lib/regions";
import { cn } from "@/lib/utils";

const ITEMS: { kind: RegionKind; Icon: typeof ZoomIn; tile: string }[] = [
  { kind: "zoom", Icon: ZoomIn, tile: "bg-highlight/20 text-highlight" },
  { kind: "speed", Icon: FastForward, tile: "bg-speed/20 text-speed" },
];

/** The + menu: adds a zoom or speed region at the playhead. Z and S do the same. */
export default function AddMenu({
  onAdd,
}: {
  onAdd: (kind: RegionKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="icon-xs"
            aria-label="Add at playhead"
          />
        }
      >
        <Plus />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="w-54">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add at playhead</DropdownMenuLabel>
          {ITEMS.map(({ kind, Icon, tile }) => {
            const { label, hint, key } = REGIONS[kind];
            return (
              <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-md",
                    tile,
                  )}
                >
                  <Icon />
                </span>
                <span className="flex-1">
                  <span className="block text-xs leading-4 font-semibold">
                    {label}
                  </span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">
                    {hint}
                  </span>
                </span>
                <Kbd>{key}</Kbd>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
