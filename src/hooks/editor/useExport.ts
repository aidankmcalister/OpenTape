import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/useTauri";
import {
  aboutMegabytes,
  DEFAULT_EXPORT,
  exportLayout,
  exportOptions,
  RESOLUTIONS,
  scaleLayout,
  zoomTrack,
  type Look,
  type Region,
  type ExportSettings,
} from "@/lib/editor/edits";
import type { Size } from "@/lib/geometry";
import type { Playback } from "./usePlayback";

export type ExportState =
  | { stage: "idle" }
  | { stage: "exporting"; progress: number }
  | { stage: "done"; path: string; copied: boolean }
  | { stage: "failed"; reason: string };

const SHOWS_FOR_MS = { done: 4000, failed: 5000 };

export function useExport(
  look: Look,
  regions: Region[],
  { videoSize, durationMs }: Pick<Playback, "videoSize" | "durationMs">,
) {
  const [state, setState] = useState<ExportState>({ stage: "idle" });
  const [settings, setSettings] = useState(DEFAULT_EXPORT);
  const layoutAt = (size: Size, zoom: number[]) =>
    scaleLayout(
      exportLayout(look, size, zoom),
      RESOLUTIONS[settings.resolution],
    );

  useTauriEvent(
    "export-progress",
    (progress) =>
      setState((current) =>
        current.stage === "exporting"
          ? { stage: "exporting", progress }
          : current,
      ),
    "window",
  );

  useEffect(() => {
    if (state.stage !== "done" && state.stage !== "failed") return;
    const timeout = setTimeout(
      () => setState({ stage: "idle" }),
      SHOWS_FOR_MS[state.stage],
    );
    return () => clearTimeout(timeout);
  }, [state.stage]);

  async function start(size: Size) {
    setState({ stage: "exporting", progress: 0 });
    try {
      const zoom = zoomTrack(regions, durationMs);
      const layout = layoutAt(size, zoom);
      const path = await invoke<string>("export_recording", {
        layout,
        options: exportOptions(settings),
      });
      setState({ stage: "done", path, copied: settings.to === "clipboard" });
    } catch (error) {
      setState({ stage: "failed", reason: String(error) });
    }
  }

  const canStart = videoSize !== null && state.stage !== "exporting";
  const output = videoSize ? layoutAt(videoSize, []) : null;
  return {
    state,
    start: canStart ? () => void start(videoSize) : null,
    settings,
    change: (change: Partial<ExportSettings>) =>
      setSettings((current) => ({ ...current, ...change })),
    output: output && {
      width: output.width,
      height: output.height,
      megabytes: aboutMegabytes(output, durationMs, settings),
    },
    showInFinder: () => {
      if (state.stage !== "done") return;
      invoke("show_export_in_finder", { path: state.path }).catch(
        console.error,
      );
    },
  };
}

export type Exporting = ReturnType<typeof useExport>;
