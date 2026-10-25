import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { keyLabel, SHORTCUTS } from "@/lib/editor/keymap";

export default function ShortcutsSheet() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" />
        }
      >
        <Keyboard />
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-120">
        <header className="flex h-14 items-center justify-between border-b border-hairline pr-3 pl-4">
          <DialogTitle className="text-heading font-semibold">
            Keyboard shortcuts
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon" aria-label="Close" />}
          >
            <X />
          </DialogClose>
        </header>
        {SHORTCUTS.map(({ group, rows }) => (
          <section
            key={group}
            className="flex flex-col px-4 py-3 not-first-of-type:border-t not-first-of-type:border-hairline"
          >
            <h3 className="flex h-8 items-center text-ui font-semibold">
              {group}
            </h3>
            {rows.map(({ label, actions }) => (
              <div
                key={label}
                className="flex h-8 items-center justify-between text-ui"
              >
                {label}
                <span className="flex gap-1">
                  {actions.map((action) => (
                    <Kbd key={action}>{keyLabel(action)}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
        <p className="px-4 pb-4 text-ui text-muted-foreground">
          Hold ← or → to keep stepping.
        </p>
      </DialogContent>
    </Dialog>
  );
}
