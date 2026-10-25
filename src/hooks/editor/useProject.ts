import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useInvokeOnMount, useRustValue } from "@/hooks/useTauri";
import type { CursorLog, ShownRecording } from "@/lib/bindings";
import { type CursorClick, readClicks } from "@/lib/editor/cursor";
import type { Appearance } from "@/lib/editor/appearance";
import {
  addRegion,
  changeRegion,
  dragRegions,
  MIN_REGION_MS,
  nextId,
  removeRegionAt,
  removeRegions,
  type Region,
  type RegionDrag,
  type RegionKind,
} from "@/lib/editor/regions";
import {
  type Clip,
  keptTime,
  removeClip,
  splitClip,
  trimClip,
} from "@/lib/editor/clips";
import { MIN_BLOCK_PX } from "@/lib/editor/timeline";
import {
  changeAppearance,
  editClips,
  editRegions,
  historyOf,
  NEW_PROJECT,
  projectJson,
  type Project,
  readProject,
  record,
  redo,
  undo,
} from "@/lib/editor/project";
import type { Clock } from "@/lib/time";

export function useProject(
  clock: Clock,
  durationMs: number,
  trackWidthPx: number,
) {
  const [history, setHistory] = useState(() => historyOf(NEW_PROJECT));
  const [draft, setDraft] = useState<Project | null>(null);
  const latestDraft = useRef<Project | null>(null);
  const present = useRef(history.present);
  useLayoutEffect(() => {
    present.current = history.present;
  });
  const showDraft = (next: Project | null) => {
    latestDraft.current = next;
    setDraft(next);
  };
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [isCutting, setIsCutting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const playheadMs = () => clock.seconds() * 1000;
  const change = (edit: (project: Project) => Project) =>
    setHistory((current) => record(current, edit(current.present)));
  const changeRegions = (edit: (regions: Region[]) => Region[]) =>
    change((project) => editRegions(project, edit));
  const apply = (edit: (project: Project) => Project, isPreview = false) =>
    isPreview ? showDraft(edit(present.current)) : change(edit);
  const inKeptTime =
    (edit: (shown: Region[], lengthMs: number) => Region[]) =>
    (project: Project) =>
      editRegions(project, (regions) =>
        keptTime(project.clips, durationMs).edit(regions, edit),
      );
  const changeClips = (edit: (clips: Clip[]) => Clip[], isPreview = false) =>
    apply((project) => editClips(project, edit), isPreview);
  const project = draft ?? history.present;
  const time = keptTime(project.clips, durationMs);
  const shown = time.shown(project.regions);
  const minMs =
    trackWidthPx > 0
      ? Math.max(MIN_REGION_MS, (MIN_BLOCK_PX / trackWidthPx) * time.lengthMs)
      : MIN_REGION_MS;
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
    openEditor: (id: number) => {
      selectOnly([id]);
      setEditingId(id);
    },
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
      change(
        inKeptTime((regions, lengthMs) =>
          addRegion(regions, kind, atMs, lengthMs, minMs),
        ),
      );
      selectOnly([nextId(project.regions)]);
    },
    retime: (
      ids: number[],
      drag: RegionDrag,
      deltaMs: number,
      isPreview = false,
    ) =>
      apply(
        inKeptTime((regions, lengthMs) =>
          dragRegions(regions, ids, drag, deltaMs, lengthMs, minMs),
        ),
        isPreview,
      ),
    trim: (
      id: number,
      edge: "start" | "end",
      deltaMs: number,
      isPreview = false,
    ) =>
      changeClips(
        (clips) => trimClip(clips, id, edge, deltaMs, durationMs),
        isPreview,
      ),
    setAppearance: (change: Partial<Appearance>, isPreview = false) =>
      apply((project) => changeAppearance(project, change), isPreview),
    setRegion: (
      id: number,
      change: Parameters<typeof changeRegion>[2],
      isPreview = false,
    ) =>
      apply(
        (project) =>
          editRegions(project, (regions) => changeRegion(regions, id, change)),
        isPreview,
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
    commit: () => {
      const committed = latestDraft.current;
      if (committed) change(() => committed);
      showDraft(null);
    },
    saved: history.present,
    load: (project: Project) => {
      setHistory(historyOf(project));
      showDraft(null);
    },
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export type Edits = ReturnType<typeof useProject>;

export function useSavedProject(edits: Edits) {
  const [isLoaded, setIsLoaded] = useState(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useInvokeOnMount<string | null>("load_project", (json) => {
    edits.load(readProject(json));
    setIsLoaded(true);
  });
  const json = isLoaded ? projectJson(edits.saved) : null;
  useEffect(() => {
    if (json === null) return;
    saving.current = saving.current
      .then(() => invoke("save_project", { json }))
      .catch(console.error);
  }, [json]);
}

export function useOpenedRecording() {
  const [recording, setRecording] = useState<ShownRecording | null>(null);
  useRustValue("editor_recording", "current-recording", setRecording, "window");

  if (!recording) return null;
  return {
    name: recording.name,
    videoSrc: convertFileSrc(recording.videoPath),
  };
}

export function useClicks(): CursorClick[] {
  const [clicks, setClicks] = useState<CursorClick[]>([]);
  useInvokeOnMount<CursorLog | null>("cursor_log", (log) => {
    if (log) setClicks(readClicks(log.meta, log.events));
  });
  return clicks;
}

export function useLanes() {
  const [solo, setSolo] = useState<RegionKind | null>(null);
  const [collapsed, setCollapsed] = useState<RegionKind[]>([]);
  return {
    solo,
    collapsed,
    toggleSolo: (kind: RegionKind) =>
      setSolo((current) => (current === kind ? null : kind)),
    toggleCollapsed: (kind: RegionKind) =>
      setCollapsed((current) =>
        current.includes(kind)
          ? current.filter((other) => other !== kind)
          : [...current, kind],
      ),
  };
}

export type Lanes = ReturnType<typeof useLanes>;
