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
import { useLanes } from "@/hooks/editor/useLanes";
import { useClicks } from "@/hooks/editor/useClicks";
import { ringEvents } from "@/lib/editor/cursor";
import ModifierEditor from "@/components/editor/timeline/ModifierEditor";
import DevPanel from "@/components/editor/header/DevPanel";
import { KINDS, regionKindForKey } from "@/lib/editor/regions";
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
  const edits = useProject(playback.clock, playback.durationMs);
  useSavedProject(edits);
  const lanes = useLanes();
  const editing = edits.project.regions.find(
    ({ id }) => id === edits.editingId,
  );
  const focusedZoom =
    editing?.kind === "zoom" && edits.selectedIds.length === 1 ? editing : null;
  const { appearance, regions, clips } = edits.project;
  const soloed = lanes.solo
    ? regions.filter(({ kind }) => kind === lanes.solo)
    : regions;
  useSpeed(playback, soloed);
  useCuts(playback, clips);
  const clicks = useClicks();
  const rings = ringEvents(clicks, regions);
  const exporting = useExport(edits.project, playback, rings);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const nudgeOr =
    (drag: "move" | "end", deltaMs: number, step: () => void) => () =>
      edits.selectedIds.length > 0 ? edits.nudge(drag, deltaMs) : step();
  useKeymap(
    {
      togglePlay: playback.togglePlay,
      stepBack: nudgeOr("move", -100, () => playback.step(-1)),
      stepForward: nudgeOr("move", 100, () => playback.step(1)),
      leapBack: nudgeOr("move", -1000, () => playback.leap(-1000)),
      leapForward: nudgeOr("move", 1000, () => playback.leap(1000)),
      toStart: nudgeOr("end", -100, playback.toStart),
      toEnd: nudgeOr("end", 100, playback.toEnd),
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
    },
    (key) => {
      const kind = regionKindForKey(key);
      if (!kind || !KINDS.includes(kind)) return false;
      edits.add(kind);
      return true;
    },
  );
  return (
    <>
      <Header name={name}>
        <div className="flex items-center gap-1">
          {import.meta.env.DEV ? (
            <DevPanel edits={edits} durationMs={playback.durationMs} />
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
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Stage
            src={videoSrc}
            appearance={appearance}
            ratio={playback.ratio}
            clock={playback.clock}
            regions={soloed}
            rings={ringEvents(clicks, soloed)}
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
          <Island className="shrink-0">
            <Transport
              playback={playback}
              edits={edits}
              isAddOpen={isAddOpen}
              onAddOpenChange={setIsAddOpen}
            />
            <Timeline
              clock={playback.clock}
              durationMs={playback.durationMs}
              edits={edits}
              onSeek={playback.seek}
              heldMs={playback.heldMs}
              onSkim={playback.skim}
              lanes={lanes}
            />
          </Island>
          <ModifierEditor edits={edits} />
        </div>
      </main>
    </>
  );
}
