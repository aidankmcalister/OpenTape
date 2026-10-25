import { useRef } from "react";
import { Plus } from "lucide-react";
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
import { REGIONS, type RegionKind } from "@/lib/editor/regions";
import { KindTile } from "./kinds";

export default function AddMenu({
  isOpen,
  onOpenChange,
  onAdd,
  kinds,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAdd: (kind: RegionKind) => void;
  kinds: RegionKind[];
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
      <PopoverContent align="start" initialFocus={search} className="w-60 p-0">
        <Command>
          <CommandInput ref={search} placeholder="Search modifiers" />
          <CommandList>
            <CommandEmpty>No modifiers found.</CommandEmpty>
            <CommandGroup>
              {kinds.map((kind) => (
                <CommandItem
                  key={kind}
                  value={REGIONS[kind].label}
                  keywords={[REGIONS[kind].key]}
                  onSelect={() => {
                    onAdd(kind);
                    onOpenChange(false);
                  }}
                >
                  <KindTile kind={kind} />
                  {REGIONS[kind].label}
                  <CommandShortcut>
                    <Kbd>{REGIONS[kind].key}</Kbd>
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
