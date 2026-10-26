import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Edits, useVisibleBox } from "@/hooks/editor/useProject";
import {
  CURSOR_STYLES,
  type CursorMode,
  type CursorSettings,
  type CursorStyle,
  DEFAULT_CURSOR,
} from "@/lib/editor/appearance";
import {
  CURSOR_MODES,
  CURSOR_SECTIONS,
  cursorPictures,
  type CursorTrack,
} from "@/lib/editor/cursor";
import type { SettingValue } from "@/lib/editor/regions";
import { cn } from "@/lib/utils";
import { Dim, PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";

export default function CursorPanel({
  edits,
  track,
}: {
  edits: Edits;
  track: CursorTrack;
}) {
  const [isAdvancedOpen, setAdvancedOpen] = useState(false);
  const { cursor } = edits.project.appearance;
  const change = (key: string, value: SettingValue, isPreview = false) =>
    edits.setAppearance({ cursor: { ...cursor, [key]: value } }, isPreview);
  const edit = {
    value: (key: string) => cursor[key as keyof CursorSettings],
    set: (key: string, value: SettingValue) => change(key, value),
    preview: (key: string, value: SettingValue) => change(key, value, true),
    commit: edits.commit,
  };
  const isStyled = cursor.mode === "Styled";
  return (
    <>
      <PanelHeader
        title="Cursor"
        onReset={() => edits.setAppearance({ cursor: DEFAULT_CURSOR })}
      />
      <Section>
        <SettingControl
          setting={{
            kind: "choice",
            key: "mode",
            options: Object.keys(CURSOR_MODES) as CursorMode[],
          }}
          edit={edit}
        />
        <p className="text-label leading-4 text-muted-foreground">
          {CURSOR_MODES[cursor.mode]}
        </p>
      </Section>
      <Dim when={!isStyled}>
        {CURSOR_SECTIONS.map(({ title, settings }) => {
          const isAdvanced = title === "Advanced";
          const isOpen = !isAdvanced || isAdvancedOpen;
          return (
            <Section
              key={title}
              title={title}
              action={
                isAdvanced ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={isOpen ? "Fold advanced" : "Open advanced"}
                    aria-expanded={isOpen}
                    onClick={() => setAdvancedOpen(!isOpen)}
                  >
                    <ChevronDown className={cn(isOpen && "rotate-180")} />
                  </Button>
                ) : null
              }
            >
              {title === "Style" ? (
                <StyleTiles
                  track={track}
                  style={cursor.style}
                  onChange={(style) => change("style", style)}
                />
              ) : null}
              {isOpen
                ? settings.map((setting, index) => (
                    <SettingControl key={index} setting={setting} edit={edit} />
                  ))
                : null}
            </Section>
          );
        })}
      </Dim>
    </>
  );
}

function StyleTiles({
  track,
  style,
  onChange,
}: {
  track: CursorTrack;
  style: CursorStyle;
  onChange: (style: CursorStyle) => void;
}) {
  const styles = Object.keys(CURSOR_STYLES) as CursorStyle[];
  return (
    <ToggleGroup
      spacing={2}
      aria-label="Cursor style"
      className="w-full justify-between"
      value={[style]}
      onValueChange={([next]) => next && onChange(next as CursorStyle)}
    >
      {styles.map((option) => {
        const arrow = cursorPictures(track.images, option).find(
          ({ kind }) => kind === "arrow",
        );
        return (
          <ToggleGroupItem
            key={option}
            value={option}
            aria-label={option}
            className="size-12 min-w-12 bg-background p-0 inset-ring inset-ring-hairline aria-pressed:inset-ring-2 aria-pressed:inset-ring-highlight"
          >
            {option === "Dot" ? (
              <span className="size-5 rounded-full border-2 border-cursor-edge/90 bg-cursor/55" />
            ) : arrow ? (
              <TilePicture src={arrow.src} />
            ) : null}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function TilePicture({ src }: { src: string }) {
  const box = useVisibleBox(src);
  if (!box) return null;
  const scale = 32 / box.full.height;
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={box.width * scale}
      height={box.height * scale}
    >
      <image href={src} width={box.full.width} height={box.full.height} />
    </svg>
  );
}
