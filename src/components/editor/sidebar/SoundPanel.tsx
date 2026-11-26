import type { Edits } from "@/hooks/editor/useProject";
import type { SoundTrack } from "@/lib/bindings";
import type { SettingValue } from "@/lib/editor/regions";
import {
  DEFAULT_SOUND,
  SOUND_TRACKS,
  TRACK_SETTINGS,
} from "@/lib/editor/sound";
import { PanelHeader, Section } from "../Panel";
import SettingControl from "../timeline/SettingControl";

export default function SoundPanel({
  edits,
  tracks,
}: {
  edits: Edits;
  tracks: SoundTrack[] | null;
}) {
  const { sound } = edits.project;
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
      ) : (
        SOUND_TRACKS.filter(({ track }) => tracks?.includes(track)).map(
          ({ track, title }) => (
            <Section key={track} title={title}>
              {TRACK_SETTINGS.map((setting) => (
                <SettingControl
                  key={setting.key}
                  setting={setting}
                  values={sound[track]}
                  onChange={(key: string, value: SettingValue, isPreview) =>
                    edits.setSound(
                      { [track]: { ...sound[track], [key]: value } },
                      isPreview,
                    )
                  }
                  onCommit={edits.commit}
                />
              ))}
            </Section>
          ),
        )
      )}
    </>
  );
}
