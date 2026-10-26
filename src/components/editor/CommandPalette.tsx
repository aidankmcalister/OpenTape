import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { paletteCommands, type PaletteCommand } from "@/lib/editor/keymap";
import { KindTile } from "./timeline/kinds";

export default function CommandPalette({
  open,
  onOpenChange,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (command: PaletteCommand) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-1/3 translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command>
          <CommandInput placeholder="Search actions" />
          <CommandList className="scroll-fade-b">
            <CommandEmpty>No actions found.</CommandEmpty>
            {paletteCommands().map(({ group, commands }) => (
              <CommandGroup key={group} heading={group}>
                {commands.map((command) => (
                  <CommandItem
                    key={command.label}
                    value={command.label}
                    onSelect={() => {
                      onOpenChange(false);
                      onRun(command);
                    }}
                  >
                    {"kind" in command ? (
                      <KindTile kind={command.kind} />
                    ) : null}
                    {command.label}
                    {command.keys ? (
                      <CommandShortcut>
                        <Kbd>{command.keys}</Kbd>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
