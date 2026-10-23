import type { Size } from "@/lib/geometry";
import { type Appearance, DEFAULT_APPEARANCE, frameLayout } from "./appearance";
import { type Region, sourceAt } from "./regions";
import { zoomAt } from "./zoom";

export type Project = { appearance: Appearance; regions: Region[] };

export const NEW_PROJECT: Project = {
  appearance: DEFAULT_APPEARANCE,
  regions: [],
};

export function editRegions(
  project: Project,
  edit: (regions: Region[]) => Region[],
): Project {
  const regions = edit(project.regions);
  return regions === project.regions ? project : { ...project, regions };
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
