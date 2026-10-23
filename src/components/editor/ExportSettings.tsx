import type { ReactNode } from "react";
import { ChevronDown, Clipboard, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      <PopoverContent align="end" sideOffset={8} className="w-85 gap-0 p-0">
        <div className="flex flex-col gap-3 p-3">
          <h3 className="text-ui font-semibold">Export settings</h3>
          <div className="grid grid-cols-2 gap-3">
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
            aside={output ? `${output.width} × ${output.height}` : null}
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
        <div className="flex justify-end border-t border-hairline p-3 text-caption text-muted-foreground">
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
  aside,
  note,
  disabled,
}: {
  label: string;
  value: Value;
  options: Record<Value, ReactNode>;
  onChange: (value: Value) => void;
  aside?: ReactNode;
  note?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between">
        <span className="text-ui text-muted-foreground">{label}</span>
        <span className="font-mono text-caption text-muted-foreground">
          {aside}
        </span>
      </div>
      <Tabs value={value} onValueChange={(next: Value) => onChange(next)}>
        <TabsList className="w-full">
          {(Object.keys(options) as Value[]).map((option) => (
            <TabsTrigger key={option} value={option} disabled={disabled}>
              {options[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {note ? (
        <span className="text-caption text-muted-foreground">{note}</span>
      ) : null}
    </div>
  );
}
