import { useRef } from "react";
import { ChevronsDownUp, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { Lanes } from "@/hooks/editor/useProject";
import { ALL_KINDS, REGIONS, type RegionKind } from "@/lib/editor/regions";
import { cn } from "@/lib/utils";
import { KindTile } from "./kinds";

export default function AddMenu({
  isOpen,
  onOpenChange,
  onAdd,
  lanes,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAdd: (kind: RegionKind) => void;
  lanes: Lanes;
}) {
  const search = useRef<HTMLInputElement>(null);
  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Add a modifier" />
        }
      >
        <Plus />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        initialFocus={search}
        className="w-60 gap-0 p-0"
      >
        <Command>
          <CommandInput ref={search} placeholder="Search modifiers" />
          <CommandList className="scroll-fade-b">
            <CommandEmpty>No modifiers found.</CommandEmpty>
            <CommandGroup heading="Modifiers">
              {ALL_KINDS.map((kind) => {
                const isSoon = REGIONS[kind].status === "soon";
                return (
                  <CommandItem
                    key={kind}
                    value={REGIONS[kind].label}
                    keywords={[REGIONS[kind].key]}
                    disabled={isSoon}
                    onSelect={() => {
                      onAdd(kind);
                      onOpenChange(false);
                    }}
                  >
                    <KindTile
                      kind={kind}
                      className={cn(isSoon && "bg-muted text-muted-foreground")}
                    />
                    {REGIONS[kind].label}
                    <CommandShortcut>
                      {isSoon ? "Coming soon" : <Kbd>{REGIONS[kind].key}</Kbd>}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {lanes.hasLanes ? (
          <>
            <Separator />
            <div className="p-1">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  lanes.toggleAll();
                  onOpenChange(false);
                }}
              >
                {lanes.isAllCollapsed ? (
                  <ChevronsUpDown data-icon="inline-start" />
                ) : (
                  <ChevronsDownUp data-icon="inline-start" />
                )}
                {lanes.isAllCollapsed
                  ? "Expand all lanes"
                  : "Collapse all lanes"}
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
