import { useState } from "react";
import {
  addRegion,
  removeRegion,
  removeRegionAt,
  type Region,
  type RegionKind,
} from "@/lib/editor/regions";
import { editRegions, NEW_PROJECT, type Project } from "@/lib/editor/project";
import { historyOf, record, redo, undo } from "@/lib/editor/history";
import type { Clock } from "@/lib/time";

export function useProject(clock: Clock, durationMs: number) {
  const [history, setHistory] = useState(() => historyOf(NEW_PROJECT));
  const [draft, setDraft] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const playheadMs = () => clock.seconds() * 1000;
  const change = (edit: (project: Project) => Project) =>
    setHistory((current) => record(current, edit(current.present)));
  const changeRegions = (edit: (regions: Region[]) => Region[]) =>
    change((project) => editRegions(project, edit));
  const project = draft ?? history.present;
  return {
    project,
    selected:
      project.regions.find((region) => region.id === selectedId) ?? null,
    selectedId,
    select: setSelectedId,
    change,
    add: (kind: RegionKind) => {
      const atMs = playheadMs();
      changeRegions((regions) => addRegion(regions, kind, atMs, durationMs));
    },
    removeRegion: () => {
      const atMs = playheadMs();
      changeRegions((regions) =>
        selectedId === null
          ? removeRegionAt(regions, atMs)
          : removeRegion(regions, selectedId),
      );
      setSelectedId(null);
    },
    preview: (edit: (project: Project) => Project) =>
      setDraft(edit(history.present)),
    commit: () => {
      if (draft) change(() => draft);
      setDraft(null);
    },
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export type Edits = ReturnType<typeof useProject>;
