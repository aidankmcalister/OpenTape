import type { Edits } from "@/hooks/editor/useProject";
import type { SoundTrack } from "@/lib/bindings";
import type { SettingValue } from "@/lib/editor/regions";
import { DEFAULT_SOUND, SOUND_SETTINGS } from "@/lib/editor/sound";
import { Dim, PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";

const FULL_VOLUME = { microphone: 100, systemAudio: 100 };

export default function SoundPanel({
  edits,
  tracks,
}: {
  edits: Edits;
  tracks: SoundTrack[] | null;
}) {
  const { sound } = edits.project;
  const control = {
    values: sound,
    onChange: (key: string, value: SettingValue, isPreview?: boolean) =>
      edits.setSound({ [key]: value }, isPreview),
    onCommit: edits.commit,
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
            <SettingControl setting={SOUND_SETTINGS.isMuted} {...control} />
          </Section>
          <Dim when>
            <Section title="Volume">
              {heard.map((track) => (
                <SettingControl
                  key={track}
                  setting={SOUND_SETTINGS[track]}
                  values={FULL_VOLUME}
                  onChange={() => {}}
                  onCommit={() => {}}
                />
              ))}
            </Section>
          </Dim>
          <Section>
            <p className="text-label leading-4 text-muted-foreground">
              Volume per track is coming soon.
            </p>
          </Section>
        </>
      ) : null}
    </>
  );
}
