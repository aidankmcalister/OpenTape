import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePointerHover } from "@/hooks/usePointerHover";
import {
  useInvokeOnMount,
  useOneAtATime,
  useTauriEvent,
} from "@/hooks/useTauri";
import type { Session, Setup, Target } from "@/lib/bindings";
import type { Point, Rect } from "@/lib/geometry";
import {
  holdsCursor,
  nextWindowId,
  pickerView,
  pointerOnDisplay,
  record,
  sameView,
  type PickerView,
} from "@/lib/picker/view";

// The cursor streams in 60 times a second, so it lives in a ref and only a change in what's shown redraws.
export function usePicker(displayId: number) {
  const session = useRef<Session | null>(null);
  const cursor = useRef<Point | null>(null);
  const [view, setView] = useState<PickerView | null>(null);
  const [framing, setFraming] = useState<{
    isFraming: boolean;
    windowRect: Rect | null;
  }>({ isFraming: false, windowRect: null });
  const { setPointer } = usePointerHover();
  // Return and the Record button can land together; the picker records once.
  const oneAtATime = useOneAtATime();

  function refreshView() {
    const next =
      session.current && pickerView(session.current, cursor.current, displayId);
    setView((shown) => (sameView(shown, next) ? shown : next));
    setPointer(pointerOnDisplay(session.current, cursor.current, displayId));
  }

  useInvokeOnMount<Setup | null>("picker_setup", (setup) => {
    if (!setup) return;
    // Events that arrived first are newer than the setup.
    session.current ??= setup.session;
    cursor.current ??= setup.cursor;
    refreshView();
  });
  useTauriEvent("picker-session", (next) => {
    session.current = next;
    refreshView();
  });
  useTauriEvent(
    "picker-cursor",
    (next) => {
      cursor.current = next;
      refreshView();
    },
    "window",
  );
  useTauriEvent(
    "picker-recording",
    (windowRect) => setFraming({ isFraming: true, windowRect }),
    "window",
  );

  const recordOnce = (target: Target) =>
    void oneAtATime(() => record(target)).catch(console.error);

  // Every overlay hears the key; only the one under the cursor acts. The Area box handles its own.
  useTauriEvent(
    "picker-key",
    (key) => {
      if (!session.current || !view || view.mode === "area") return;
      const { displays, windows } = session.current.sources;
      const display = displays.find(({ id }) => id === displayId);
      if (!display || !holdsCursor(display, cursor.current)) return;
      const target = view.highlight?.target;
      if (key === "Enter" && target) recordOnce(target);
      if (key === "Tab" && view.mode === "window") {
        const currentId =
          target?.kind === "window" ? target.windowId : undefined;
        const nextId = nextWindowId(windows, currentId);
        if (nextId !== undefined) {
          invoke("pin_window", { windowId: nextId }).catch(console.error);
        }
      }
    },
    "window",
  );

  return { view, framing, record: recordOnce };
}

// A page can only blur its own content, so Rust's native glass blurs the apps behind the pill.
export function useGlass<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const placed = useRef("");

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { x, y, width, height } = element.getBoundingClientRect();
    const key = [x, y, width, height].map(Math.round).join();
    if (key === placed.current) return;
    placed.current = key;
    invoke("place_overlay_glass", { rect: { x, y, width, height } }).catch(
      console.error,
    );
  });

  // Forgotten so a remount puts the glass back.
  useEffect(
    () => () => {
      placed.current = "";
      invoke("place_overlay_glass", { rect: null }).catch(console.error);
    },
    [],
  );

  return ref;
}
