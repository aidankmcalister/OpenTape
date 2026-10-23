import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenedRecording } from "@/hooks/editor/useOpenedRecording";
import Header from "@/components/editor/Header";
import Island from "@/components/editor/Island";
import Stage from "@/components/editor/Stage";
import Transport from "@/components/editor/Transport";
import { usePlayback } from "@/hooks/editor/usePlayback";
import { useKeymap } from "@/hooks/editor/useKeymap";
import Timeline from "@/components/editor/Timeline";
import ExportButton from "@/components/editor/ExportButton";
import ExportSettings from "@/components/editor/ExportSettings";
import LookPanel from "@/components/editor/LookPanel";
import { useExport } from "@/hooks/editor/useExport";
import { useProject } from "@/hooks/editor/useProject";

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

function Workspace({ name, videoSrc }: { name: string; videoSrc: string }) {
  const playback = usePlayback(videoSrc);
  const edits = useProject(playback.clock, playback.durationMs);
  const { look, regions } = edits.project;
  const exporting = useExport(look, regions, playback);
  useKeymap({
    togglePlay: playback.togglePlay,
    stepBack: () => playback.step(-1),
    stepForward: () => playback.step(1),
    toStart: playback.toStart,
    toEnd: playback.toEnd,
    toggleLoop: playback.toggleLoop,
    toggleSound: playback.toggleSound,
    export: () => exporting.start?.(),
    addZoom: edits.addZoom,
    removeRegion: edits.removeRegion,
    undo: edits.undo,
    redo: edits.redo,
  });
  return (
    <>
      <Header name={name}>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            disabled={!edits.canUndo}
            onClick={edits.undo}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            disabled={!edits.canRedo}
            onClick={edits.redo}
          >
            <Redo2 />
          </Button>
          <ExportButton
            state={exporting.state}
            onExport={exporting.start}
            onShowInFinder={exporting.showInFinder}
            settings={<ExportSettings exporting={exporting} />}
          />
        </div>
      </Header>
      <main className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <LookPanel edits={edits} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Stage
            src={videoSrc}
            look={look}
            ratio={playback.ratio}
            clock={playback.clock}
            regions={regions}
            {...playback.videoProps}
          />
          <Island className="shrink-0">
            <Transport playback={playback} />
            <Timeline
              clock={playback.clock}
              durationMs={playback.durationMs}
              edits={edits}
              onSeek={playback.seek}
            />
          </Island>
        </div>
      </main>
    </>
  );
}
