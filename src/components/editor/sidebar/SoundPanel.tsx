import type { Edits } from "@/hooks/editor/useProject";
import type { SoundTrack } from "@/lib/bindings";
import type { SettingValue } from "@/lib/editor/regions";
import {
  DEFAULT_SOUND,
  SOUND_SETTINGS,
  type SoundSettings,
} from "@/lib/editor/sound";
import { Dim, PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";

export default function SoundPanel({
  edits,
  tracks,
}: {
  edits: Edits;
  tracks: SoundTrack[] | null;
}) {
  const { sound } = edits.project;
  const change = (key: string, value: SettingValue, isPreview = false) =>
    edits.setSound({ [key]: value }, isPreview);
  const edit = {
    value: (key: string) => sound[key as keyof SoundSettings],
    set: (key: string, value: SettingValue) => change(key, value),
    preview: (key: string, value: SettingValue) => change(key, value, true),
    commit: edits.commit,
  };
  const heard = (["microphone", "systemAudio"] as const).filter((track) =>
    tracks?.includes(track),
  );
  return (
    <>
      <PanelHeader
        title="Sound"
        onReset={() => edits.setSound(DEFAULT_SOUND)}
      />
      {tracks?.length === 0 ? (
        <Section>
          <p className="text-label leading-4 text-muted-foreground">
            This recording has no sound.
          </p>
        </Section>
      ) : tracks ? (
        <>
          <Section>
            <SettingControl setting={SOUND_SETTINGS.isMuted} edit={edit} />
          </Section>
          <Dim when={sound.isMuted}>
            <Section title="Volume">
              {heard.map((track) => (
                <SettingControl
                  key={track}
                  setting={SOUND_SETTINGS[track]}
                  edit={edit}
                />
              ))}
            </Section>
          </Dim>
        </>
      ) : null}
    </>
  );
}
