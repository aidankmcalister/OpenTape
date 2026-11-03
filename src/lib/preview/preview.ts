import type { ExportState } from "@/lib/editor/export";

export type DockLayer =
  | "processing"
  | "actions"
  | "saving"
  | "copying"
  | "saved"
  | "copied"
  | "failed";

export function dockLayer(
  state: ExportState,
  isProcessing: boolean,
): DockLayer {
  if (isProcessing) return "processing";
  switch (state.stage) {
    case "idle":
      return "actions";
    case "exporting":
      return state.toClipboard ? "copying" : "saving";
    case "done":
      return state.toClipboard ? "copied" : "saved";
    case "failed":
      return "failed";
  }
}

export function loopProgress(seconds: number, durationMs: number): number {
  return durationMs ? Math.min((seconds * 1000) / durationMs, 1) : 0;
}
