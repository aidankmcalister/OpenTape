import { useOpenedRecording } from "@/hooks/editor/useOpenedRecording";
import Header from "@/components/editor/Header";
import Stage from "@/components/editor/Stage";
import Transport from "@/components/editor/Transport";
import { usePlayback } from "@/hooks/editor/usePlayback";
import Timeline from "@/components/editor/Timeline";

/** The editor window. Each piece lives in its own file; this only puts them together. */
export default function Editor() {
  const recording = useOpenedRecording();
  return (
    <div className="flex h-screen flex-col bg-background">
      <Header name={recording?.name ?? null} />
      {recording && <Workspace videoSrc={recording.videoSrc} />}
    </div>
  );
}

/** Lays out the editor's islands under the header. It holds playback, which the stage and transport share. */
function Workspace({ videoSrc }: { videoSrc: string }) {
  const playback = usePlayback(videoSrc);
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <Stage src={videoSrc} {...playback.videoProps} />
      <Transport
        isPlaying={playback.isPlaying}
        onTogglePlay={playback.togglePlay}
        clock={playback.clock}
        durationMs={playback.durationMs}
      />
      <Timeline
        clock={playback.clock}
        durationMs={playback.durationMs}
        onSeek={playback.seek}
      />
    </main>
  );
}
