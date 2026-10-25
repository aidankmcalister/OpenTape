import type { ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, Clipboard, File } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Exporting } from "@/hooks/editor/useExport";
import {
  QUALITIES,
  type ExportSettings as Settings,
} from "@/lib/editor/export";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { MorphPill, PillMessage } from "@/components/Pill";

export default function ExportButton({ exporting }: { exporting: Exporting }) {
  const { state, start: onExport, showInFinder: onShowInFinder } = exporting;
  const progress = state.stage === "exporting" ? state.progress : 1;
  const reason = state.stage === "failed" ? state.reason : undefined;
  return (
    <MorphPill
      active={state.stage}
      className="border-transparent bg-primary text-primary-foreground"
      layers={{
        idle: (
          <div className="flex items-center">
            <Button
              variant="primary"
              size="pill-sm"
              disabled={!onExport}
              onClick={onExport ?? undefined}
            >
              Export
              <Kbd>⌘E</Kbd>
            </Button>
            <Separator
              orientation="vertical"
              className="mx-1 h-4 bg-primary-foreground/30 data-vertical:self-center"
            />
            <ExportSettings exporting={exporting} />
          </div>
        ),
        exporting: (
          <div className="flex w-41.5 items-center justify-between pr-3">
            <PillMessage icon={<Spinner />}>Exporting</PillMessage>
            <span className="text-ui font-medium tabular-nums">
              {Math.round(progress * 100)}%
            </span>
          </div>
        ),
        done:
          state.stage === "done" && state.copied ? (
            <PillMessage icon={<Check />}>Copied to clipboard</PillMessage>
          ) : (
            <>
              <PillMessage icon={<Check />}>Exported</PillMessage>
              <Button
                variant="primary"
                size="xs"
                className="mr-1 rounded-full bg-primary-foreground/20 hover:bg-primary-foreground/30"
                onClick={onShowInFinder}
              >
                Show in Finder
              </Button>
            </>
          ),
        failed: (
          <span title={reason}>
            <PillMessage icon={<CircleAlert />}>Export failed</PillMessage>
          </span>
        ),
      }}
    />
  );
}

function ExportSettings({ exporting }: { exporting: Exporting }) {
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
          <PopoverTitle>Export settings</PopoverTitle>
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
        <span className="text-label text-muted-foreground">{label}</span>
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
