import { useState } from "react";
import { Redo, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenedRecording } from "@/hooks/editor/useOpenedRecording";
import Header from "@/components/editor/header/Header";
import Island from "@/components/editor/Island";
import Stage from "@/components/editor/Stage";
import Transport from "@/components/editor/timeline/Transport";
import { useCuts, usePlayback, useSpeed } from "@/hooks/editor/usePlayback";
import { useKeymap } from "@/hooks/editor/useKeymap";
import Timeline from "@/components/editor/timeline/Timeline";
import ExportButton from "@/components/editor/header/ExportButton";
import ExportSettings from "@/components/editor/header/ExportSettings";
import Sidebar from "@/components/editor/sidebar/Sidebar";
import { useExport } from "@/hooks/editor/useExport";
import { useProject } from "@/hooks/editor/useProject";
import { useSavedProject } from "@/hooks/editor/useSavedProject";
import { useTimelineLimit } from "@/hooks/editor/useTimelineLimit";
import ResizeThumb from "@/components/editor/timeline/ResizeThumb";
import ModifierEditor from "@/components/editor/timeline/ModifierEditor";
import { useDevFlags, useMostRows } from "@/hooks/editor/useDevFlags";
import DevPanel from "@/components/editor/header/DevPanel";
import { ALL_KINDS, KINDS, rowCount } from "@/lib/editor/regions";
import { FRAME_MS } from "@/lib/editor/timeline";
import { changeRegion } from "@/lib/editor/regions";
import { editRegions } from "@/lib/editor/project";

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
  const dev = useDevFlags();
  const edits = useProject(playback.clock, playback.durationMs);
  useSavedProject(edits);
  const mostRows = useMostRows(rowCount(edits.project.regions));
  const timeline = useTimelineLimit();
  const editing = edits.project.regions.find(
    ({ id }) => id === edits.editingId,
  );
  const focusedZoom =
    editing?.kind === "zoom" && edits.selectedIds.length === 1 ? editing : null;
  const { appearance, regions, clips } = edits.project;
  useSpeed(playback, regions);
  useCuts(playback, clips);
  const exporting = useExport(edits.project, playback);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const nudgeOr = (deltaMs: number, step: () => void) => () =>
    edits.selectedIds.length > 0 ? edits.nudge(deltaMs) : step();
  useKeymap({
    togglePlay: playback.togglePlay,
    stepBack: nudgeOr(-FRAME_MS, () => playback.step(-1)),
    stepForward: nudgeOr(FRAME_MS, () => playback.step(1)),
    leapBack: nudgeOr(-1000, () => playback.leap(-1000)),
    leapForward: nudgeOr(1000, () => playback.leap(1000)),
    toStart: playback.toStart,
    toEnd: playback.toEnd,
    toggleLoop: playback.toggleLoop,
    toggleSound: playback.toggleSound,
    export: () => exporting.start?.(),
    addZoom: () => edits.add("zoom"),
    addSpeed: () => edits.add("speed"),
    toggleCut: () => edits.setCutting(!edits.isCutting),
    openAdd: () => setIsAddOpen(true),
    remove: edits.remove,
    selectAll: edits.selectAll,
    deselect: () => {
      edits.select([]);
      edits.setCutting(false);
    },
    undo: edits.undo,
    redo: edits.redo,
  });
  return (
    <>
      <Header name={name}>
        <div className="flex items-center gap-1">
          {import.meta.env.DEV ? (
            <DevPanel
              dev={dev}
              edits={edits}
              durationMs={playback.durationMs}
              mostRows={mostRows}
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            disabled={!edits.canUndo}
            onClick={edits.undo}
          >
            <Undo />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            disabled={!edits.canRedo}
            onClick={edits.redo}
          >
            <Redo />
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
        <Sidebar edits={edits} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Stage
            src={videoSrc}
            appearance={appearance}
            ratio={playback.ratio}
            clock={playback.clock}
            regions={regions}
            focus={
              focusedZoom && {
                zoom: focusedZoom,
                onMove: (center) =>
                  edits.preview((project) =>
                    editRegions(project, (all) =>
                      changeRegion(all, focusedZoom.id, { center }),
                    ),
                  ),
                onDone: edits.commit,
              }
            }
            {...playback.videoProps}
          />
          <ResizeThumb
            draggingPx={timeline.draggingPx}
            thumbProps={timeline.thumbProps}
          />
          <Island className="shrink-0">
            <Transport
              playback={playback}
              edits={edits}
              isAddOpen={isAddOpen}
              onAddOpenChange={setIsAddOpen}
              kinds={dev.previewTypes ? ALL_KINDS : KINDS}
            />
            <Timeline
              clock={playback.clock}
              durationMs={playback.durationMs}
              edits={edits}
              onSeek={playback.seek}
              heldMs={playback.heldMs}
              onSkim={playback.skim}
              limitPx={timeline.limitPx}
            />
          </Island>
          <ModifierEditor edits={edits} />
        </div>
      </main>
    </>
  );
}
