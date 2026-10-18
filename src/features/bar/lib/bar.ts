import { invoke } from "@tauri-apps/api/core";
import type { Animation } from "@/lib/bindings/Animation";
import type { Devices } from "@/lib/bindings/Devices";

export const quitApp = () => invoke<void>("quit");

export const listDevices = () => invoke<Devices>("list_devices");

/** Tells Rust the pill's size, so the glass behind it and its click area follow. */
export const shapeBar = (
  width: number,
  height: number,
  animation: Animation | null,
) => invoke<void>("shape_bar", { width, height, animation });
