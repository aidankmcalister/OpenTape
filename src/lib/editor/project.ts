import type { Size } from "@/lib/geometry";
import { type Appearance, DEFAULT_APPEARANCE, frameLayout } from "./appearance";
import type { Clip } from "./clips";
import { closeRows, type Region, sourceAt } from "./regions";
import { zoomAt } from "./zoom";

export type Project = {
  appearance: Appearance;
  regions: Region[];
  clips: Clip[];
};

export const NEW_PROJECT: Project = {
  appearance: DEFAULT_APPEARANCE,
  regions: [],
  clips: [],
};

export const PROJECT_VERSION = 1;

export function projectJson(project: Project): string {
  return JSON.stringify({ version: PROJECT_VERSION, ...project });
}

export function readProject(json: string | null): Project {
  if (json === null) return NEW_PROJECT;
  const saved: Partial<Project> = JSON.parse(json);
  return {
    appearance: { ...DEFAULT_APPEARANCE, ...saved.appearance },
    regions: saved.regions ?? [],
    clips: saved.clips ?? [],
  };
}

export function editRegions(
  project: Project,
  edit: (regions: Region[]) => Region[],
): Project {
  const regions = closeRows(edit(project.regions));
  return regions === project.regions ? project : { ...project, regions };
}

export function editClips(
  project: Project,
  edit: (clips: Clip[]) => Clip[],
): Project {
  const clips = edit(project.clips);
  return clips === project.clips ? project : { ...project, clips };
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

export function frameAt(
  scene: {
    appearance: Appearance;
    regions: Region[];
    canvas: Size;
    ratio: number;
  },
  outputMs: number,
) {
  return {
    ...frameLayout(scene.appearance, scene.canvas, scene.ratio),
    zoom: zoomAt(scene.regions, outputMs),
    sourceMs: sourceAt(scene.regions, outputMs),
  };
}
