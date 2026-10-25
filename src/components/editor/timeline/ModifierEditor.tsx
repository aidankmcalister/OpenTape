import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import type { Edits } from "@/hooks/editor/useProject";
import {
  changeSetting,
  REGIONS,
  type Region,
  type RegionKind,
  type SettingValue,
} from "@/lib/editor/regions";
import { parseTimeLabel, timeLabel } from "@/lib/editor/timeline";
import { NumberField } from "../Panel";
import { KindTile } from "./kinds";
import SettingControl from "./SettingControl";

export default function ModifierEditor({ edits }: { edits: Edits }) {
  const [shownId, setShownId] = useState(edits.editingId);
  if (edits.editingId !== null && edits.editingId !== shownId)
    setShownId(edits.editingId);
  const modifier = edits.shown.find(({ id }) => id === shownId);
  const count = edits.selectedIds.length;
  return (
    <Popover
      open={modifier !== undefined && edits.editingId !== null}
      onOpenChange={(open, { event }) => {
        const target = event?.target;
        const isOnStage =
          target instanceof Element && target.closest("[data-keeps-editor]");
        if (!open && !isOnStage) edits.closeEditor();
      }}
    >
      <PopoverContent
        key={shownId}
        side="top"
        sideOffset={8}
        collisionPadding={8}
        initialFocus={false}
        anchor={() => document.querySelector(`[data-region-id="${shownId}"]`)}
        className="w-80 gap-0 p-0"
      >
        {modifier && count > 1 ? (
          <Header
            title={`${count} selected`}
            onDelete={edits.remove}
            onClose={edits.closeEditor}
          />
        ) : null}
        {modifier && count <= 1 ? (
          <Settings modifier={modifier} edits={edits} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function Settings({ modifier, edits }: { modifier: Region; edits: Edits }) {
  const { label, settings } = REGIONS[modifier.kind];
  const edit = {
    region: modifier,
    set: (key: string, value: SettingValue) =>
      edits.setRegion(modifier.id, changeSetting(modifier, key, value)),
    preview: (key: string, value: SettingValue) =>
      edits.setRegion(modifier.id, changeSetting(modifier, key, value), true),
    change: (change: Partial<Region>) => edits.setRegion(modifier.id, change),
    commit: edits.commit,
  };
  const lengthMs = modifier.endMs - modifier.startMs;
  return (
    <>
      <Header
        title={label}
        kind={modifier.kind}
        onDelete={edits.remove}
        onClose={edits.closeEditor}
      />
      <div className="flex flex-col gap-2 p-3">
        {settings.map((setting, index) => (
          <SettingControl key={index} setting={setting} edit={edit} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-hairline p-3">
        <NumberField
          label="Start"
          value={modifier.startMs}
          unit=""
          format={timeLabel}
          parse={parseTimeLabel}
          step={100}
          onChange={(ms) =>
            edits.retime([modifier.id], "move", ms - modifier.startMs)
          }
        />
        <NumberField
          label="Length"
          value={lengthMs / 1000}
          unit="s"
          format={(seconds) => seconds.toFixed(1)}
          step={0.1}
          onChange={(seconds) =>
            edits.retime([modifier.id], "end", seconds * 1000 - lengthMs)
          }
        />
      </div>
    </>
  );
}

function Header({
  title,
  kind,
  onDelete,
  onClose,
}: {
  title: string;
  kind?: RegionKind;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex h-12 items-center gap-3 px-3 not-last:border-b not-last:border-hairline">
      {kind ? <KindTile kind={kind} className="size-6" /> : null}
      <PopoverTitle>{title}</PopoverTitle>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${title.toLowerCase()}`}
        className="ml-auto"
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        className="-ml-2"
        onClick={onClose}
      >
        <X />
      </Button>
    </header>
  );
}
