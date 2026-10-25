import { useState } from "react";
import {
  addRegion,
  dragRegions,
  nextId,
  removeRegionAt,
  removeRegions,
  type Region,
  type RegionDrag,
  type RegionKind,
} from "@/lib/editor/regions";
import { type Clip, keptTime, removeClip, splitClip } from "@/lib/editor/clips";
import {
  editClips,
  editRegions,
  NEW_PROJECT,
  type Project,
} from "@/lib/editor/project";
import { historyOf, record, redo, undo } from "@/lib/editor/history";
import type { Clock } from "@/lib/time";

export function useProject(clock: Clock, durationMs: number) {
  const [history, setHistory] = useState(() => historyOf(NEW_PROJECT));
  const [draft, setDraft] = useState<Project | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [isCutting, setIsCutting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const playheadMs = () => clock.seconds() * 1000;
  const change = (edit: (project: Project) => Project) =>
    setHistory((current) => record(current, edit(current.present)));
  const changeRegions = (edit: (regions: Region[]) => Region[]) =>
    change((project) => editRegions(project, edit));
  const changeShown = (edit: (shown: Region[], lengthMs: number) => Region[]) =>
    change((project) =>
      editRegions(project, (regions) =>
        keptTime(project.clips, durationMs).edit(regions, edit),
      ),
    );
  const changeClips = (edit: (clips: Clip[]) => Clip[]) =>
    change((project) => editClips(project, edit));
  const project = draft ?? history.present;
  const time = keptTime(project.clips, durationMs);
  const shown = time.shown(project.regions);
  const selectOnly = (ids: number[], clipId: number | null = null) => {
    setSelectedIds(ids);
    setSelectedClipId(clipId);
    setEditingId(null);
  };
  return {
    project,
    time,
    shown,
    editingId: project.regions.some(({ id }) => id === editingId)
      ? editingId
      : null,
    openEditor: setEditingId,
    closeEditor: () => setEditingId(null),
    selectedIds,
    selectedClipId,
    select: (ids: number[]) => selectOnly(ids),
    pick: (id: number, isAdding: boolean) => {
      if (!isAdding && selectedIds.includes(id)) return;
      if (!isAdding) return selectOnly([id]);
      selectOnly(
        selectedIds.includes(id)
          ? selectedIds.filter((other) => other !== id)
          : [...selectedIds, id],
      );
    },
    selectAll: () => selectOnly(project.regions.map((region) => region.id)),
    selectClip: (id: number) => selectOnly([], id),
    change,
    add: (kind: RegionKind) => {
      const atMs = time.at(playheadMs());
      changeShown((regions, lengthMs) =>
        addRegion(regions, kind, atMs, lengthMs),
      );
      selectOnly([nextId(project.regions)]);
    },
    retime: (id: number, drag: RegionDrag, deltaMs: number) =>
      changeShown((regions, lengthMs) =>
        dragRegions(regions, [id], drag, deltaMs, lengthMs),
      ),
    nudge: (drag: "move" | "end", deltaMs: number) =>
      changeShown((regions, lengthMs) =>
        dragRegions(regions, selectedIds, drag, deltaMs, lengthMs),
      ),
    isCutting,
    setCutting: setIsCutting,
    split: (atMs: number) =>
      changeClips((clips) => splitClip(clips, atMs, durationMs)),
    remove: () => {
      if (selectedClipId !== null) {
        changeClips((clips) => removeClip(clips, selectedClipId, durationMs));
        setSelectedClipId(null);
        return;
      }
      const atMs = playheadMs();
      changeRegions((regions) =>
        selectedIds.length === 0
          ? removeRegionAt(regions, atMs)
          : removeRegions(regions, selectedIds),
      );
      setSelectedIds([]);
    },
    preview: (edit: (project: Project) => Project) =>
      setDraft(edit(history.present)),
    commit: () => {
      if (draft) change(() => draft);
      setDraft(null);
    },
    saved: history.present,
    load: (project: Project) => {
      setHistory(historyOf(project));
      setDraft(null);
    },
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export type Edits = ReturnType<typeof useProject>;
