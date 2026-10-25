import {
  type Appearance,
  DEFAULT_APPEARANCE,
  readAppearance,
} from "./appearance";
import { type Clip, fitToClips } from "./clips";
import { type CursorTrack, withSuggestions } from "./cursor";
import { type Region, REGIONS } from "./regions";

export type Project = {
  appearance: Appearance;
  regions: Region[];
  clips: Clip[];
  suggestionsMade: boolean;
};

export const NEW_PROJECT: Project = {
  appearance: DEFAULT_APPEARANCE,
  regions: [],
  clips: [],
  suggestionsMade: false,
};

export const PROJECT_VERSION = 1;

export function projectJson(project: Project): string {
  return JSON.stringify({ version: PROJECT_VERSION, ...project });
}

export function readProject(json: string | null): Project {
  if (json === null) return NEW_PROJECT;
  const saved: Partial<Project> = JSON.parse(json);
  return {
    appearance: readAppearance(saved.appearance),
    regions: (saved.regions ?? []).filter(({ kind }) => kind in REGIONS),
    clips: saved.clips ?? [],
    suggestionsMade: saved.suggestionsMade ?? false,
  };
}

export function editRegions(
  project: Project,
  edit: (regions: Region[]) => Region[],
): Project {
  const regions = edit(project.regions);
  return regions === project.regions ? project : { ...project, regions };
}

export function suggest(
  project: Project,
  track: Pick<CursorTrack, "clicks" | "keys" | "moves">,
  durationMs: number,
): Project {
  if (project.suggestionsMade) return project;
  const regions = withSuggestions(track, project.regions, durationMs);
  return { ...project, regions, suggestionsMade: true };
}

export function editClips(
  project: Project,
  edit: (clips: Clip[]) => Clip[],
): Project {
  const clips = edit(project.clips);
  if (clips === project.clips) return project;
  return { ...project, clips, regions: fitToClips(project.regions, clips) };
}

export function changeAppearance(
  project: Project,
  change: Partial<Appearance>,
): Project {
  const appearance = { ...project.appearance, ...change };
  return JSON.stringify(appearance) === JSON.stringify(project.appearance)
    ? project
    : { ...project, appearance };
}

export type History<T> = { past: T[]; present: T; future: T[] };

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function record<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future;
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: next, future };
}
