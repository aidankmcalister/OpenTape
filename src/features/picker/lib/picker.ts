import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "@/lib/bindings/Mode";
import type { Setup } from "@/lib/bindings/Setup";
import type { Target } from "@/lib/bindings/Target";
import type { Rect } from "@/lib/geometry";

/**
 * Return and Tab, but only the ones Rust sends to this overlay: the one holding the Area box,
 * or else the one under the cursor. Esc is handled entirely in Rust.
 */
export type PickerKey = "Enter" | "Tab";

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
