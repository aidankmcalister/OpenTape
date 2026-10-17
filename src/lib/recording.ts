import { invoke } from "@tauri-apps/api/core";

export type Mode = "display" | "window" | "area";

export type DisplayInfo = { id: number; width: number; height: number };
export type WindowInfo = { id: number; app: string; title: string };
export type Sources = { displays: DisplayInfo[]; windows: WindowInfo[] };

/** What to record. Matches the Rust `Target` enum. */
export type Target =
  | { kind: "display"; displayId: number }
  | { kind: "window"; windowId: number }
  | {
      kind: "area";
      displayId: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export type SavedRecording = {
  folder: string;
  videoPath: string;
  frames: number;
};

export const listSources = () => invoke<Sources>("list_sources");
export const startRecording = (target: Target) =>
  invoke<void>("start_recording", { target });
export const stopRecording = () => invoke<SavedRecording>("stop_recording");

const AREA_WIDTH = 1280;
const AREA_HEIGHT = 720;

/** A 1280×720 area in the middle of the display, shrunk to fit if the display is smaller. */
export function centeredArea(display: DisplayInfo) {
  const width = Math.min(AREA_WIDTH, display.width);
  const height = Math.min(AREA_HEIGHT, display.height);
  return {
    x: Math.round((display.width - width) / 2),
    y: Math.round((display.height - height) / 2),
    width,
    height,
  };
}

/** The choices for the dropdown in each mode. Window choices are windows; the others are displays. */
export function choicesFor(
  mode: Mode,
  sources: Sources,
): { id: number; label: string }[] {
  if (mode === "window") {
    return sources.windows.map((window) => ({
      id: window.id,
      label: `${window.app} — ${window.title}`,
    }));
  }
  return sources.displays.map((display) => ({
    id: display.id,
    label:
      mode === "area"
        ? `Center 1280×720 of display ${display.id}`
        : `Display ${display.id} (${display.width}×${display.height})`,
  }));
}

/** Builds what to send to Rust from the chosen mode and dropdown value. */
export function targetFor(
  mode: Mode,
  id: number,
  sources: Sources,
): Target | null {
  if (mode === "window") return { kind: "window", windowId: id };
  const display = sources.displays.find((candidate) => candidate.id === id);
  if (!display) return null;
  if (mode === "display") return { kind: "display", displayId: id };
  return { kind: "area", displayId: id, ...centeredArea(display) };
}
