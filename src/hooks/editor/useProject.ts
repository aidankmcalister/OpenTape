import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useInvokeOnMount, useRustValue } from "@/hooks/useTauri";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useExport } from "./useExport";
import { usePlayback } from "./usePlayback";
import type {
  CursorImage,
  CursorLog,
  ShownRecording,
  SoundTrack,
  TypingSpot,
} from "@/lib/bindings";
import {
  type CursorTrack,
  NO_CURSOR,
  readCursor,
  ringEvents,
  typingStretches,
  visibleBox,
} from "@/lib/editor/cursor";
import type { Appearance } from "@/lib/editor/appearance";
import {
  addRegion,
  changeRegion,
  dragRegions,
  nextId,
  removeRegions,
  settleAll,
  settleSuggestion,
  type Region,
  type RegionDrag,
  type RegionKind,
} from "@/lib/editor/regions";
import {
  type Clip,
  fitHidden,
  timeMap,
  removeClip,
  restoreCut,
  splitClip,
  trimClip,
} from "@/lib/editor/clips";
import {
  changeProject,
  editClips,
  editRegions,
  historyOf,
  NEW_PROJECT,
  type Project,
  readProject,
  record,
  redo,
  suggest,
  undo,
} from "@/lib/editor/project";
import type { SoundSettings } from "@/lib/editor/sound";
import { pickedIds } from "@/lib/editor/timeline";
import type { Clock } from "@/lib/time";

export function useProject(
  clock: Clock,
  durationMs: number,
  cursor: CursorTrack,
) {
  const [history, setHistory] = useState(() => historyOf(NEW_PROJECT));
  const canSuggest = cursor.moves.length > 0 && durationMs > 0;
  const { suggestionsMade, keysAdded } = history.present;
  if (canSuggest && !(suggestionsMade && keysAdded)) {
    setHistory((current) => ({
      ...current,
      present: suggest(current.present, cursor, durationMs),
    }));
  }
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
        timeMap(project.clips, project.regions, durationMs).edit(regions, edit),
      );
  const changeClips = (edit: (clips: Clip[]) => Clip[], isPreview = false) =>
    apply((project) => editClips(project, edit), isPreview);
  const project = draft ?? history.present;
  const time = timeMap(project.clips, project.regions, durationMs);
  const shown = time.shown(project.regions);
  // Blocks hidden in removed footage are never selected, so Delete can't reach them.
  const selected = selectedIds.filter((id) => shown.some((at) => at.id === id));
  /** Kept-time edges a drag catches besides other blocks: the playhead and every clip edge. */
  const snapEdgesMs = () => [
    time.at(playheadMs()),
    ...time.clips.flatMap(({ startMs, endMs }) => [startMs, endMs]),
  ];
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
    selectedIds: selected,
    selectedClipId,
    select: (ids: number[]) => selectOnly(ids),
    /** A click on a block or a run (`ids`); `isToggling` with ⌘ or ⇧. */
    pick: (ids: number[], isToggling: boolean) => {
      const next = pickedIds(selected, ids, isToggling);
      if (next !== selected) selectOnly(next);
    },
    selectAll: () => selectOnly(shown.map((region) => region.id)),
    selectClip: (id: number) => selectOnly([], id),
    change,
    add: (
      kind: RegionKind,
      atMs = time.at(playheadMs()),
      settings?: Region["settings"],
    ) => {
      change(
        inKeptTime((regions, lengthMs) => {
          const added = addRegion(regions, kind, atMs, lengthMs);
          if (!settings || added === regions) return added;
          return [...regions, { ...added[added.length - 1], settings }];
        }),
      );
      selectOnly([nextId(project.regions)]);
    },
    snapEdgesMs,
    /** `withinMs`: how near an edge a drag must come to catch it. */
    retime: (
      ids: number[],
      drag: RegionDrag,
      deltaMs: number,
      { isPreview = false, withinMs = 0 } = {},
    ) =>
      apply(
        inKeptTime((regions, lengthMs) =>
          dragRegions(regions, ids, drag, deltaMs, lengthMs, {
            edgesMs: snapEdgesMs(),
            withinMs,
          }),
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
      apply(
        (project) => changeProject(project, "appearance", change),
        isPreview,
      ),
    rename: (title: string) => change((project) => ({ ...project, title })),
    setSound: (change: Partial<SoundSettings>, isPreview = false) =>
      apply((project) => changeProject(project, "sound", change), isPreview),
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
    settle: (id: number, isKept: boolean) =>
      changeRegions((regions) => settleSuggestion(regions, id, isKept)),
    settleAll: (isKept: boolean) =>
      changeRegions((regions) => settleAll(regions, isKept)),
    isCutting,
    setCutting: setIsCutting,
    split: (atMs: number) =>
      changeClips((clips) => splitClip(clips, atMs, durationMs)),
    restore: (afterId: number) =>
      change((project) => {
        const clips = restoreCut(project.clips, afterId);
        if (clips === project.clips) return project;
        const regions = fitHidden(project.regions, project.clips, durationMs);
        return { ...project, clips, regions };
      }),
    remove: () => {
      if (selectedClipId !== null) {
        changeClips((clips) => removeClip(clips, selectedClipId, durationMs));
        setSelectedClipId(null);
        return;
      }
      if (selected.length === 0) return;
      changeRegions((regions) => removeRegions(regions, selected));
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

export function useSavedProject(edits: Edits, fresh: Project | null) {
  const [saved, setSaved] = useState<string | null>();
  const [isLoaded, setIsLoaded] = useState(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useInvokeOnMount<string | null>("load_project", setSaved);
  if (!isLoaded && saved !== undefined && fresh) {
    setIsLoaded(true);
    edits.load(readProject(saved, fresh));
  }
  const json = isLoaded ? JSON.stringify(edits.saved) : null;
  useEffect(() => {
    if (json === null) return;
    saving.current = saving.current
      .then(() => invoke("save_project", { json }))
      .catch(console.error);
  }, [json]);
  return isLoaded;
}

export function useFinishedRecording(videoSrc: string, loops: boolean) {
  const playback = usePlayback(videoSrc, loops);
  const read = useCursor();
  const cursor = read ?? NO_CURSOR;
  const edits = useProject(playback.clock, playback.durationMs, cursor);
  const app = useAppSettings();
  const isLoaded = useSavedProject(edits, app.newProject);
  const isReady = isLoaded && read !== null && playback.videoSize !== null;
  const rings = ringEvents(cursor.clicks, edits.project.appearance.cursor);
  const exporting = useExport(
    edits.project,
    playback,
    rings,
    cursor,
    app,
    isReady,
  );
  return { playback, cursor, edits, app, rings, exporting, isLoaded, isReady };
}

export function useOpenedRecording() {
  const [recording, setRecording] = useState<ShownRecording | null>(null);
  useRustValue("shown_recording", "current-recording", setRecording, "window");

  if (!recording) return null;
  return {
    name: recording.name,
    videoSrc: convertFileSrc(recording.videoPath),
    fileSrc: (name: string) =>
      convertFileSrc(recording.videoPath.replace(/[^/]+$/, name)),
  };
}

export function useBackgroundImage(onAdded: (name: string) => void) {
  const [isOver, setIsOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(onAdded);
  useLayoutEffect(() => {
    latest.current = onAdded;
  });
  const add = useCallback((path: string | null) => {
    setError(null);
    invoke<string | null>("add_background", { path }).then(
      (name) => name && latest.current(name),
      (failed) => setError(String(failed)),
    );
  }, []);
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      setIsOver(payload.type === "enter" || payload.type === "over");
      if (payload.type === "drop" && payload.paths[0]) add(payload.paths[0]);
    });
    unlisten.catch(console.error);
    return () => {
      unlisten.then((stop) => stop()).catch(console.error);
    };
  }, [add]);
  return { isOver, error, browse: () => add(null) };
}

export function useCursor(): CursorTrack | null {
  const [track, setTrack] = useState<CursorTrack | null>(null);
  const [images, setImages] = useState<CursorImage[]>([]);
  useInvokeOnMount<CursorLog | null>("cursor_log", (log) => {
    if (!log) return setTrack(NO_CURSOR);
    const read = readCursor(log.meta, log.events);
    const stretches = typingStretches(read.keys).map(({ startMs, endMs }) => ({
      start: startMs / 1000,
      end: endMs / 1000,
    }));
    const withTyped = (spots: TypingSpot[]) =>
      setTrack({
        ...read,
        typed: spots.map(({ t, x, y }) => ({ ms: t * 1000, x, y })),
      });
    if (stretches.length === 0) return withTyped([]);
    invoke<TypingSpot[]>("typing_spots", { stretches }).then(
      withTyped,
      (error) => {
        console.error(error);
        withTyped([]);
      },
    );
  });
  useInvokeOnMount<CursorImage[]>("cursor_images", setImages);
  return useMemo(() => track && { ...track, images }, [track, images]);
}

export function useSoundTracks() {
  const [tracks, setTracks] = useState<SoundTrack[] | null>(null);
  useInvokeOnMount("sound_tracks", setTracks);
  return tracks;
}

export function useVisibleBox(src: string) {
  const [box, setBox] = useState<
    ReturnType<typeof visibleBox> & {
      full: { width: number; height: number };
    }
  >();
  useEffect(() => {
    let isLive = true;
    const image = new Image();
    image.src = src;
    void image.decode().then(() => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [image.naturalWidth, image.naturalHeight];
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0);
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
      if (!isLive || !pixels) return;
      const full = { width: canvas.width, height: canvas.height };
      setBox({ ...visibleBox(pixels.data, canvas.width), full });
    });
    return () => {
      isLive = false;
    };
  }, [src]);
  return box;
}

/** `opensSkipped`: the Skipped row starts open, for a recording with only skipped keys. */
export function useLanes(kinds: RegionKind[], opensSkipped: boolean) {
  const [solo, setSolo] = useState<RegionKind | null>(null);
  const [collapsed, setCollapsed] = useState<RegionKind[]>([]);
  const [showsSkippedChoice, setShowsSkipped] = useState<boolean | null>(null);
  const showsSkipped = showsSkippedChoice ?? opensSkipped;
  const isAllCollapsed = kinds.every((kind) => collapsed.includes(kind));
  return {
    kinds,
    solo,
    collapsed,
    showsSkipped,
    toggleSkipped: () => setShowsSkipped(!showsSkipped),
    hasLanes: kinds.length > 0,
    isAllCollapsed,
    toggleAll: () => setCollapsed(isAllCollapsed ? [] : kinds),
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
