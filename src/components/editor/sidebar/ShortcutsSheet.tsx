import type { ComponentProps } from "react";
import { Keyboard } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { ACTION_NAMES, keyLabel, SHORTCUTS } from "@/lib/editor/keymap";
import { DialogPanel, DialogSection } from "../Panel";

export default function ShortcutsSheet(
  props: Pick<ComponentProps<typeof DialogPanel>, "open" | "onOpenChange">,
) {
  return (
    <DialogPanel
      {...props}
      title="Keyboard shortcuts"
      icon={<Keyboard />}
      className="sm:max-w-120"
    >
      {SHORTCUTS.map(({ group, rows }) => (
        <DialogSection key={group} title={group}>
          {rows.map(({ actions, label = ACTION_NAMES[actions![0]], keys }) => (
            <div
              key={label}
              className="flex h-8 items-center justify-between text-ui"
            >
              {label}
              <span className="flex gap-1">
                {(actions?.map(keyLabel) ?? keys ?? []).map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </DialogSection>
      ))}
      <p className="px-4 pb-4 text-ui text-muted-foreground">
        Hold ← or → to keep stepping.
      </p>
    </DialogPanel>
  );
}
