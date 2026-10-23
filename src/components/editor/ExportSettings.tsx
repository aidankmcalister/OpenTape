import type { ReactNode } from "react";
import { ChevronDown, Clipboard, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Exporting } from "@/hooks/editor/useExport";
import { QUALITIES, type ExportSettings as Settings } from "@/lib/editor/edits";

export default function ExportSettings({
  exporting,
}: {
  exporting: Exporting;
}) {
  const { settings, change, output } = exporting;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="primary"
            size="icon-round"
            aria-label="Export settings"
          />
        }
      >
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-85 gap-0 overflow-hidden rounded-xl border border-glass-border bg-glass p-0 ring-0 backdrop-blur-xl"
      >
        <div className="flex flex-col gap-4 p-4">
          <h3 className="text-ui font-semibold">Export settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <Choice<Settings["format"]>
              label="Format"
              value={settings.format}
              options={{ mp4: "MP4", gif: "GIF" }}
              onChange={(format) => change({ format })}
            />
            <Choice<"30" | "60">
              label="Frame rate"
              value={`${settings.frameRate}`}
              options={{ 30: "30", 60: "60" }}
              onChange={(rate) =>
                change({ frameRate: rate === "30" ? 30 : 60 })
              }
            />
          </div>
          <Choice<Settings["resolution"]>
            label="Resolution"
            value={settings.resolution}
            options={{ "720p": "720p", "1080p": "1080p", "4K": "4K" }}
            onChange={(resolution) => change({ resolution })}
            note={
              output ? (
                <span className="font-mono">
                  {output.width} × {output.height}
                </span>
              ) : null
            }
          />
          <Choice<Settings["quality"]>
            label="Quality"
            value={settings.quality}
            options={{ best: "Best", balanced: "Balanced", small: "Small" }}
            onChange={(quality) => change({ quality })}
            note={QUALITIES[settings.quality].hint}
            disabled={settings.format === "gif"}
          />
          <Choice<Settings["to"]>
            label="Export to"
            value={settings.to}
            options={{
              file: (
                <>
                  <File />
                  File
                </>
              ),
              clipboard: (
                <>
                  <Clipboard />
                  Clipboard
                </>
              ),
            }}
            onChange={(to) => change({ to })}
          />
        </div>
        <div className="flex justify-between border-t border-hairline bg-background/40 px-4 py-3 text-caption text-muted-foreground">
          {output ? (
            <span className="font-mono">
              {output.megabytes === null
                ? "Size varies"
                : `About ${output.megabytes} MB`}
            </span>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Choice<Value extends string>({
  label,
  value,
  options,
  onChange,
  note,
  disabled,
}: {
  label: string;
  value: Value;
  options: Record<Value, ReactNode>;
  onChange: (value: Value) => void;
  note?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-muted-foreground">{label}</span>
      <ToggleGroup
        variant="segment"
        disabled={disabled}
        value={[value]}
        onValueChange={([next]) => next && onChange(next as Value)}
      >
        {(Object.keys(options) as Value[]).map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            className="border border-transparent bg-secondary px-3 aria-pressed:border-glass-border aria-pressed:bg-accent"
          >
            {options[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {note ? (
        <span className="text-caption text-muted-foreground">{note}</span>
      ) : null}
    </div>
  );
}
