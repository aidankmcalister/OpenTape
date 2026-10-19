import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  pointerOnDisplay,
  sameView,
  type PickerView,
} from "@/features/picker/lib/pickerView";
import { useOneAtATime } from "@/hooks/useOneAtATime";
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
 *
 * The cursor streams in 60 times a second, so it's kept out of React state: the overlay redraws
 * only when what it shows changes, like crossing into another window.
 */
export function usePicker(displayId: number): PickerState {
  const session = useRef<Session | null>(null);
  const cursor = useRef<Point | null>(null);
  const [view, setView] = useState<PickerView | null>(null);
  const { point } = usePointerHover();
  // Return and the Record button can land together; the picker records once.
  const oneAtATime = useOneAtATime();

  const follow = useCallback(() => {
    const next =
      session.current && pickerView(session.current, cursor.current, displayId);
    setView((shown) => (sameView(shown, next) ? shown : next));
    point(pointerOnDisplay(session.current, cursor.current, displayId));
  }, [displayId, point]);

  useEffect(() => {
    let isMounted = true;
    pickerSetup()
      .then((setup) => {
        if (!isMounted) return;
        // Events that arrived first are newer than the setup.
        session.current ??= setup.session;
        cursor.current ??= setup.cursor;
        follow();
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, [follow]);
  useTauriEvent<Session>(EVENTS.pickerSession, (next) => {
    session.current = next;
    follow();
  });
  useTauriEvent<Point>(
    EVENTS.pickerCursor,
    (next) => {
      cursor.current = next;
      follow();
    },
    "window",
  );

  const recordOnce = (target: Target) =>
    void oneAtATime(() => record(target)).catch(console.error);
  usePickerKeys(session, view, recordOnce);
  return { view, record: recordOnce };
}

function usePickerKeys(
  session: RefObject<Session | null>,
  view: PickerView | null,
  recordOnce: (target: Target) => void,
) {
  useTauriEvent<PickerKey>(
    EVENTS.pickerKey,
    (key) => {
      if (!session.current || !view || view.mode === "area") return;
      const target = view.highlight?.target;
      if (key === "Enter" && target) recordOnce(target);
      if (key === "Tab" && view.mode === "window") {
        const currentId =
          target?.kind === "window" ? target.windowId : undefined;
        const nextId = nextWindowId(session.current.sources.windows, currentId);
        if (nextId !== undefined) pinWindow(nextId).catch(console.error);
      }
    },
    "window",
  );
}
