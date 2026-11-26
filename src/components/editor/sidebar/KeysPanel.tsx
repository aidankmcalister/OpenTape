import type { Edits } from "@/hooks/editor/useProject";
import { DEFAULT_KEYS } from "@/lib/editor/appearance";
import type { CursorTrack } from "@/lib/editor/cursor";
import { hasCaps, KEY_SETTINGS } from "@/lib/editor/keys";
import type { SettingValue } from "@/lib/editor/regions";
import { PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";

export default function KeysPanel({
  edits,
  track,
}: {
  edits: Edits;
  track: CursorTrack;
}) {
  const { keys } = edits.project.appearance;
  const control = {
    values: keys,
    onChange: (key: string, value: SettingValue, isPreview?: boolean) =>
      edits.setAppearance({ keys: { ...keys, [key]: value } }, isPreview),
    onCommit: edits.commit,
  };
  return (
    <>
      <PanelHeader
        title="Keystrokes"
        onReset={() => edits.setAppearance({ keys: DEFAULT_KEYS })}
      />
      <Section>
        {KEY_SETTINGS.map((setting) =>
          "key" in setting ? (
            <SettingControl key={setting.key} setting={setting} {...control} />
          ) : null,
        )}
        {!hasCaps(track.pressed) ? (
          <p className="text-label leading-4 text-muted-foreground">
            This recording has no keystrokes. They're recorded only when Record
            keystrokes is on.
          </p>
        ) : null}
      </Section>
    </>
  );
}
