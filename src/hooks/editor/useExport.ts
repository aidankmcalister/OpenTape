import { useEffect, useEffectEvent, useState } from "react";
import type { AppSettings } from "@/hooks/useAppSettings";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/useTauri";
import {
  exportLayout,
  exportOptions,
  exportResolution,
  isTooBigForX,
  RESOLUTIONS,
  type ExportSettings,
  type ExportState,
  type ExportTimeline,
} from "@/lib/editor/export";
import type { CursorImage, Exported } from "@/lib/bindings";
import type { CursorStyle } from "@/lib/editor/appearance";
import {
  cursorPictures,
  type CursorTrack,
  nativeOr,
  type RingEvent,
  SHAPE_RASTER,
} from "@/lib/editor/cursor";
import type { Project } from "@/lib/editor/project";
import type { Size } from "@/lib/geometry";
import type { Playback } from "./usePlayback";

/** How long a result stays in the pill. A GIF too big for X stays longer, so it's read. */
const SHOWS_FOR_MS = { done: 4000, tooBig: 8000, failed: 5000 };

export function useExport(
  { appearance, regions, clips, sound, title }: Project,
  { videoSize, durationMs }: Pick<Playback, "videoSize" | "durationMs">,
  rings: RingEvent[],
  cursor: CursorTrack,
  app: AppSettings,
  isReady: boolean,
) {
  const [state, setState] = useState<ExportState>({ stage: "idle" });
  const [savedTo, setSavedTo] = useState<Exported | null>(null);
  const [closesAfterExport, setClosesAfterExport] = useState(false);
  const settings = app.exportSettings;
  const layoutAt = (size: Size, timeline?: Partial<ExportTimeline>) =>
    exportLayout(
      appearance,
      size,
      timeline,
      RESOLUTIONS[exportResolution(settings)],
    );

  useTauriEvent(
    "export-progress",
    (progress) =>
      setState((current) =>
        current.stage === "exporting" ? { ...current, progress } : current,
      ),
    "window",
  );

  useTauriEvent("export-and-close", () => setClosesAfterExport(true), "window");

  const showsFor =
    state.stage === "failed"
      ? SHOWS_FOR_MS.failed
      : state.stage !== "done"
        ? null
        : isTooBigForX(state.path, state.bytes)
          ? SHOWS_FOR_MS.tooBig
          : SHOWS_FOR_MS.done;
  useEffect(() => {
    if (showsFor === null) return;
    const timeout = setTimeout(() => setState({ stage: "idle" }), showsFor);
    return () => clearTimeout(timeout);
  }, [state.stage, showsFor]);

  async function start(size: Size, to: ExportSettings["to"], closes = false) {
    const toClipboard = to === "clipboard";
    setState({ stage: "exporting", progress: 0, toClipboard });
    try {
      const style = nativeOr(appearance.cursor).style;
      const images = await styledImages(cursor.images, style);
      const layout = layoutAt(size, {
        regions,
        durationMs,
        clips,
        rings,
        cursor: { ...cursor, images },
        sound,
      });
      const exported = await invoke<Exported | null>("export_recording", {
        layout,
        options: exportOptions({ ...settings, to }, title),
      });
      if (exported === null) return setState({ stage: "idle" });
      setState({ stage: "done", ...exported, toClipboard });
      if (!toClipboard) setSavedTo(exported);
      if (closes) await invoke("close_recording");
    } catch (error) {
      setState({ stage: "failed", reason: String(error) });
    }
  }

  const canStart = isReady && videoSize !== null && state.stage !== "exporting";
  const exportAndClose = useEffectEvent((size: Size) => {
    setClosesAfterExport(false);
    void start(size, "file", true);
  });
  useEffect(() => {
    if (closesAfterExport && canStart && videoSize)
      queueMicrotask(() => exportAndClose(videoSize));
  }, [closesAfterExport, canStart, videoSize]);

  const output = videoSize ? layoutAt(videoSize) : null;
  return {
    state,
    start: canStart ? (to = settings.to) => void start(videoSize, to) : null,
    showSaved:
      canStart && savedTo
        ? () => setState({ stage: "done", ...savedTo, toClipboard: false })
        : null,
    settings,
    change: (part: Partial<ExportSettings>) =>
      app.change({ export: { ...settings, ...part } }),
    output: output && {
      width: output.width,
      height: output.height,
    },
    showInFinder: () => {
      if (state.stage !== "done") return;
      invoke("show_export_in_finder").catch(console.error);
    },
  };
}

export type Exporting = ReturnType<typeof useExport>;

async function styledImages(
  images: CursorImage[],
  style: CursorStyle,
): Promise<CursorImage[]> {
  return Promise.all(
    cursorPictures(images, style).map(async ({ src, ...picture }) => ({
      ...picture,
      png: await pngOf(src, picture.width, picture.height),
    })),
  );
}

async function pngOf(src: string, width: number, height: number) {
  const prefix = "data:image/png;base64,";
  if (src.startsWith(prefix)) return src.slice(prefix.length);
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * SHAPE_RASTER);
  canvas.height = Math.ceil(height * SHAPE_RASTER);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").slice(prefix.length);
}
