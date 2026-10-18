import { useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/bindings/Session";
import type { Target } from "@/lib/bindings/Target";
import { EVENTS } from "@/lib/events";
import type { Point } from "@/lib/geometry";
import {
  pickerSetup,
  pinWindow,
  record,
  type PickerKey,
} from "@/features/picker/lib/picker";
import {
  nextWindowId,
  pickerView,
  type PickerView,
} from "@/features/picker/lib/pickerView";
import { usePointerHover } from "@/hooks/usePointerHover";
import { useTauriEvent } from "@/hooks/useTauriEvent";

type PickerState = {
  view: PickerView | null;
  /** Closes the picker and records `target`. */
  record: (target: Target) => void;
};

/**
 * What this overlay shows. The overlays get no mouse moves of their own, so hover comes from
 * the cursor Rust streams: what's under it gets `data-hovered`, which `hover:` styles match.
 */
export function usePicker(displayId: number): PickerState {
  const { session, cursor } = usePickerState();
  const view = session ? pickerView(session, cursor, displayId) : null;
  const origin = session?.sources.displays.find(
    ({ id }) => id === displayId,
  )?.frame;
  const originX = origin?.x;
  const originY = origin?.y;
  const pointer = useMemo(
    () =>
      cursor && originX !== undefined && originY !== undefined
        ? { x: cursor.x - originX, y: cursor.y - originY }
        : null,
    [cursor, originX, originY],
  );
  usePickerKeys(session, view);
  usePointerHover(pointer);
  return { view, record: (target) => void record(target) };
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
  }, []);
  useTauriEvent<Session>(EVENTS.pickerSession, setSession);
  useTauriEvent<Point>(EVENTS.pickerCursor, setCursor, "window");
  return { session, cursor };
}

function usePickerKeys(session: Session | null, view: PickerView | null) {
  useTauriEvent<PickerKey>(
    EVENTS.pickerKey,
    (key) => {
      if (!session || !view || view.mode === "area") return;
      const target = view.highlight?.target;
      if (key === "Enter" && target) void record(target);
      if (key === "Tab" && view.mode === "window") {
        const currentId =
          target?.kind === "window" ? target.windowId : undefined;
        const nextId = nextWindowId(session.sources.windows, currentId);
        if (nextId !== undefined) void pinWindow(nextId);
      }
    },
    "window",
  );
}
