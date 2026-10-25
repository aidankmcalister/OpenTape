import { Keyboard } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { keyLabel, SHORTCUTS } from "@/lib/editor/keymap";
import { DialogPanel, DialogSection } from "../Panel";

export default function ShortcutsSheet() {
  return (
    <DialogPanel
      title="Keyboard shortcuts"
      icon={<Keyboard />}
      className="sm:max-w-120"
    >
      {SHORTCUTS.map(({ group, rows }) => (
        <DialogSection key={group} title={group}>
          {rows.map(({ label, actions, keys }) => (
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
