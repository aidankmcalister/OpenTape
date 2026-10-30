import { type ReactNode, useState } from "react";
import { Redo, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import Island from "@/components/editor/Island";
import Stage from "@/components/editor/Stage";
import Transport from "@/components/editor/timeline/Transport";
import { useStageSound, useTimeMap } from "@/hooks/editor/usePlayback";
import { useKeymap } from "@/hooks/editor/useKeymap";
import Timeline from "@/components/editor/timeline/Timeline";
import ExportButton from "@/components/editor/header/ExportButton";
import UpdateChip from "@/components/editor/header/UpdateChip";
import Sidebar, {
  type EditorDialog,
  type SidebarPanel,
} from "@/components/editor/sidebar/Sidebar";
import CommandPalette from "@/components/editor/CommandPalette";
import { useElementSize } from "@/hooks/useElementSize";
import {
  useFinishedRecording,
  useLanes,
  useOpenedRecording,
  useSoundTracks,
} from "@/hooks/editor/useProject";
import { frameCrop } from "@/lib/editor/appearance";
import { timeMap } from "@/lib/editor/clips";
import ModifierEditor from "@/components/editor/timeline/ModifierEditor";
import { laneKinds, regionKindForKey } from "@/lib/editor/regions";
import type { EditorAction } from "@/lib/editor/keymap";

export default function Editor() {
  const recording = useOpenedRecording();
  return (
    <div className="flex h-screen flex-col bg-background">
      {recording ? (
        <Workspace
          key={recording.videoSrc}
          name={recording.name}
          videoSrc={recording.videoSrc}
          fileSrc={recording.fileSrc}
        />
      ) : (
        <Header name={null} />
      )}
    </div>
  );
}

function Workspace({
  name,
  videoSrc,
  fileSrc,
}: {
  name: string;
  videoSrc: string;
  fileSrc: (name: string) => string;
}) {
  const { ref: trackRef, size: track } = useElementSize<HTMLDivElement>();
  const { playback, cursor, edits, app, rings, exporting } =
    useFinishedRecording(videoSrc, track.width, false);
  const soundTracks = useSoundTracks();
  const hasSound = soundTracks === null || soundTracks.length > 0;
  const lanes = useLanes(laneKinds(edits.shown));
  const editing =
    edits.selectedIds.length === 1
      ? edits.project.regions.find(({ id }) => id === edits.editingId)
      : undefined;
  const { appearance, regions, clips } = edits.project;
  const soloed = lanes.solo
    ? regions.filter(({ kind }) => kind === lanes.solo)
    : regions;
  const time = lanes.solo
    ? timeMap(clips, soloed, playback.durationMs)
    : edits.time;
  const moves = useTimeMap(playback, time);
  useStageSound(playback, edits.project.sound);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [panel, setPanel] = useState<SidebarPanel>("background");
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const nudgeOr =
    (drag: "move" | "end", deltaMs: number, step: () => void) => () =>
      edits.selectedIds.length > 0
        ? edits.retime(edits.selectedIds, drag, deltaMs)
        : step();
  const actions: Record<EditorAction, () => void> = {
    togglePlay: moves.togglePlay,
    stepBack: nudgeOr("move", -100, () => moves.step(-1)),
    stepForward: nudgeOr("move", 100, () => moves.step(1)),
    leapBack: nudgeOr("move", -1000, () => moves.leap(-1000)),
    leapForward: nudgeOr("move", 1000, () => moves.leap(1000)),
    toStart: nudgeOr("end", -100, moves.toStart),
    toEnd: nudgeOr("end", 100, moves.toEnd),
    toggleLoop: playback.toggleLoop,
    toggleSound: playback.toggleSound,
    export: () => exporting.start?.(),
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
    openPalette: () => setDialog("palette"),
    openSettings: () => setDialog("settings"),
    openShortcuts: () => setDialog("shortcuts"),
    showBackground: () => setPanel("background"),
    showCursor: () => setPanel("cursor"),
    showSound: () => setPanel("sound"),
  };
  useKeymap(actions, (key) => {
    const kind = regionKindForKey(key);
    if (!kind) return false;
    edits.add(kind);
    return true;
  });
  return (
    <>
      <Header
        name={
          <Title name={edits.project.title ?? name} onRename={edits.rename} />
        }
      >
        <div className="flex items-center gap-1">
          <UpdateChip />
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
          <ExportButton exporting={exporting} />
        </div>
      </Header>
      <main className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <Sidebar
          edits={edits}
          cursor={cursor}
          app={app}
          sound={soundTracks}
          hasSound={hasSound}
          panel={panel}
          onPanelChange={setPanel}
          dialog={dialog}
          onDialogChange={setDialog}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Stage
            src={videoSrc}
            fileSrc={fileSrc}
            appearance={appearance}
            ratio={playback.ratio}
            clock={playback.clock}
            regions={soloed}
            clips={clips}
            rings={rings}
            cursor={cursor}
            durationMs={playback.durationMs}
            editing={
              editing
                ? {
                    region: editing,
                    onChange: (change) =>
                      edits.setRegion(editing.id, change, true),
                    onDone: edits.commit,
                  }
                : null
            }
            solo={lanes.solo}
            onSolo={lanes.toggleSolo}
            {...playback.videoProps}
          />
          <Island className="shrink-0">
            <Transport
              playback={playback}
              moves={moves}
              edits={edits}
              lanes={lanes}
              hasSound={hasSound}
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
              trackRef={trackRef}
              trackWidth={track.width}
            />
          </Island>
          <ModifierEditor
            edits={edits}
            crop={frameCrop(appearance, playback.ratio)}
          />
        </div>
      </main>
      <CommandPalette
        open={dialog === "palette"}
        onOpenChange={(open) => setDialog(open ? "palette" : null)}
        onRun={(command) =>
          "kind" in command
            ? edits.add(command.kind)
            : actions[command.action]()
        }
      />
    </>
  );
}

function Header({ name, children }: { name: ReactNode; children?: ReactNode }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-title-bar shrink-0 items-center justify-between pr-2 pl-traffic-lights text-muted-foreground"
    >
      {name}
      {children}
    </header>
  );
}

function Title({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="-ml-1.5 inline-grid h-6 cursor-text items-center rounded-sm px-1.5 transition-colors hover:bg-accent focus-within:bg-background focus-within:text-foreground focus-within:ring-1 focus-within:ring-primary">
      <span className="invisible col-start-1 row-start-1 whitespace-pre">
        {(draft ?? name) || "\u00a0"}
      </span>
      <input
        aria-label="Recording name"
        value={draft ?? name}
        className="col-start-1 row-start-1 w-full min-w-0 bg-transparent outline-none"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next && next !== name) onRename(next);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.value = name;
          if (event.key === "Enter" || event.key === "Escape")
            event.currentTarget.blur();
        }}
      />
    </label>
  );
}
