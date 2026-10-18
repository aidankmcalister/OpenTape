import { useEffect, useMemo, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EVENTS, subscribe } from "@/lib/events";
import type { Point, Rect } from "@/lib/geometry";
import { pickerSetup, pinWindow, record, type Session } from "@/lib/picker";
import { nextWindowId, pickerView, type PickerView } from "@/lib/pickerView";
import { usePointerHover } from "./usePointerHover";
import { usePickerKey } from "./usePickerKey";

/**
 * What this overlay shows. The overlays get no mouse moves of their own, so hover comes from
 * the cursor Rust streams: what's under it gets `data-hovered`, which `hover:` styles match.
 */
export function usePicker(displayId: number): PickerView | null {
  const { session, cursor } = usePickerState();
  const view = session ? pickerView(session, cursor, displayId) : null;
  const origin = session?.sources.displays.find(
    ({ id }) => id === displayId,
  )?.frame;
  const pointer = useMemo(
    () =>
      cursor && origin
        ? { x: cursor.x - origin.x, y: cursor.y - origin.y }
        : null,
    [cursor, origin?.x, origin?.y],
  );
  usePickerKeys(session, view);
  usePointerHover(pointer);
  return view;
}

/** Rust's session, plus the cursor it streams separately because it changes 60 times a second. */
function usePickerState(): { session: Session | null; cursor: Point | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  useEffect(() => {
    void pickerSetup().then((setup) => {
      setSession(setup.session);
      setCursor((current) => current ?? setup.cursor);
    });
    const stopSession = subscribe<Session>(EVENTS.pickerSession, setSession);
    const stopCursor = getCurrentWebviewWindow().listen<Point>(
      EVENTS.pickerCursor,
      ({ payload }) => setCursor(payload),
    );
    return () => {
      stopSession();
      void stopCursor.then((stop) => stop());
    };
  }, []);
  return { session, cursor };
}

function usePickerKeys(session: Session | null, view: PickerView | null) {
  usePickerKey((key) => {
    if (!session || !view || view.mode === "area") return;
    const target = view.highlight?.target;
    if (key === "Enter" && target) void record(target);
    if (key === "Tab" && view.mode === "window") {
      const currentId = target?.kind === "window" ? target.windowId : undefined;
      const nextId = nextWindowId(session.sources.windows, currentId);
      if (nextId !== undefined) void pinWindow(nextId);
    }
  });
}

export type Framing = {
  isFraming: boolean;
  /** For a window recording, where the window sits on this display. */
  window: Rect | null;
};

/** Whether this overlay now frames a recording. Rust tells only that overlay. */
export function useFraming(): Framing {
  const [framing, setFraming] = useState<Framing>({
    isFraming: false,
    window: null,
  });
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<Rect | null>(
      "picker-recording",
      ({ payload }) => setFraming({ isFraming: true, window: payload }),
    );
    return () => void unlisten.then((stop) => stop());
  }, []);
  return framing;
}
