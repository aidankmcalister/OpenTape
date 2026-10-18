import { invoke } from "@tauri-apps/api/core";
import type { Point, Rect, Size } from "./geometry";
import type { Target } from "./recording";

export type Mode = "display" | "window" | "area";

/** Frames are in global points from the top-left, the same space as the cursor. `size` is
 * what a recording would be, in pixels. */
export type DisplayInfo = {
  id: number;
  name: string;
  frame: Rect;
  size: Size;
  /** How far down from the top things stay clear of the menu bar and the notch. */
  safeTop: number;
};
type WindowInfo = {
  id: number;
  pid: number;
  app: string;
  frame: Rect;
  size: Size;
};
/** Windows are ordered front to back. Icons are PNG data URLs, one per app process. */
export type Sources = {
  displays: DisplayInfo[];
  windows: WindowInfo[];
  icons: Record<number, string>;
};

/** Rust's picker session, the only copy of it. Matches the Rust `Session`. */
export type Session = {
  mode: Mode;
  sources: Sources;
  /** A window chosen with Tab. It wins over the cursor until the cursor moves. */
  pinnedWindowId: number | null;
  areaDisplayId: number | null;
};

export type Setup = { session: Session; cursor: Point | null };

export const openPicker = (mode: Mode) => invoke<void>("open_picker", { mode });
export const closePicker = () => invoke<void>("close_picker");
export const pickerSetup = () => invoke<Setup>("picker_setup");
export const pinWindow = (windowId: number) =>
  invoke<void>("pin_window", { windowId });
export const moveArea = (displayId: number) =>
  invoke<void>("move_area", { displayId });
/** Closes the picker and starts recording `target`. */
export const record = (target: Target) => invoke<void>("record", { target });
/** Puts Rust's frosted glass under the overlay's capture bar, or hides it with null. */
export const placeOverlayGlass = (rect: Rect | null) =>
  invoke<void>("place_overlay_glass", { rect });
