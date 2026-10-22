import { useOpenedRecording } from "@/hooks/editor/useOpenedRecording";
import Header from "@/components/editor/Header";
import Stage from "@/components/editor/Stage";
import Transport from "@/components/editor/Transport";
import { usePlayback } from "@/hooks/editor/usePlayback";
import { useKeymap } from "@/hooks/editor/useKeymap";
import Timeline from "@/components/editor/Timeline";
import ExportButton from "@/components/editor/ExportButton";
import { useExport } from "@/hooks/editor/useExport";
import { DEFAULT_LOOK } from "@/lib/editor/edits";

export default function Editor() {
  const recording = useOpenedRecording();
  return (
    <div className="flex h-screen flex-col bg-background">
      {recording ? (
        <Workspace name={recording.name} videoSrc={recording.videoSrc} />
      ) : (
        <Header name={null} />
      )}
    </div>
  );
}

/** The header and the islands under it. Playback lives here because the stage, transport, timeline and export all use it. */
function Workspace({ name, videoSrc }: { name: string; videoSrc: string }) {
  const playback = usePlayback(videoSrc);
  const exporting = useExport(DEFAULT_LOOK, playback.videoSize);
  useKeymap({
    togglePlay: playback.togglePlay,
    stepBack: () => playback.step(-1),
    stepForward: () => playback.step(1),
    toStart: playback.toStart,
    toEnd: playback.toEnd,
    toggleLoop: playback.toggleLoop,
    toggleSound: playback.toggleSound,
    export: () => exporting.start?.(),
  });
  return (
    <>
      <Header name={name}>
        <ExportButton
          state={exporting.state}
          onExport={exporting.start}
          onShowInFinder={exporting.showInFinder}
        />
      </Header>
      <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
        <Stage src={videoSrc} ratio={playback.ratio} {...playback.videoProps} />
        <Transport playback={playback} />
        <Timeline
          clock={playback.clock}
          durationMs={playback.durationMs}
          onSeek={playback.seek}
        />
      </main>
    </>
  );
}
