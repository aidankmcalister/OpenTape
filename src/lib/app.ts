import { invoke } from "@tauri-apps/api/core";

export const quitApp = () => invoke<void>("quit");

/** Tells Rust the pill's size, so the glass behind it and its click area follow. */
export type Animation = {
  durationMs: number;
  ease: [number, number, number, number];
};

export const shapeBar = (
  width: number,
  height: number,
  animation: Animation | null,
) => invoke<void>("shape_bar", { width, height, animation });
