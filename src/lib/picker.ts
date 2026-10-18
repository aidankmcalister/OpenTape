import { invoke } from "@tauri-apps/api/core";
import type { Point, Rect } from "./geometry";
import type { Target } from "./recording";

export type Mode = "display" | "window" | "area";

/** Frames are in global points from the top-left, the same space as the cursor. */
export type DisplayInfo = { id: number; name: string; frame: Rect };
export type WindowInfo = {
  id: number;
  pid: number;
  app: string;
  title: string;
  frame: Rect;
};
/** Windows are ordered front to back. Icons are PNG data URLs, one per app process. */
export type Sources = {
  displays: DisplayInfo[];
  windows: WindowInfo[];
  icons: Record<number, string>;
};

export type Setup = { mode: Mode; sources: Sources; cursor: Point | null };

export const openPicker = (mode: Mode) => invoke<void>("open_picker", { mode });
export const closePicker = () => invoke<void>("close_picker");
export const pickerSetup = () => invoke<Setup>("picker_setup");
/** Closes the picker, then the record bar starts recording `target`. */
export const pick = (target: Target) => invoke<void>("pick", { target });
