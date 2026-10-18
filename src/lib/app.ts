import { invoke } from "@tauri-apps/api/core";
import { join, videoDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export const quitApp = () => invoke<void>("quit");

/** Tells Rust the pill's size, so the glass behind it and its click area follow. */
export const shapeBar = (width: number, height: number, animate: boolean) =>
  invoke<void>("shape_bar", { width, height, animate });

export async function showRecordings() {
  await revealItemInDir(await join(await videoDir(), "screen-recorder"));
}
