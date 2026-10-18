import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { EVENTS, subscribe } from "@/lib/events";
import type { Point } from "@/lib/geometry";
import { pick, pickerSetup, type Setup } from "@/lib/picker";
import {
  nextWindowId,
  pickerView,
  type Focus,
  type PickerView,
} from "@/lib/pickerView";
import { usePickerKey } from "./usePickerKey";

export function usePicker(displayId: number): PickerView | null {
  const setup = usePickerSetup();
  const focus = useFocus();
  const view = setup
    ? pickerView(
        setup,
        { ...focus, cursor: focus.cursor ?? setup.cursor },
        displayId,
      )
    : null;
  usePickerKeys(setup, view);
  return view;
}

function usePickerSetup(): Setup | null {
  const [setup, setSetup] = useState<Setup | null>(null);
  useEffect(() => {
    const load = () => pickerSetup().then(setSetup, () => setSetup(null));
    void load();
    return subscribe(EVENTS.pickerChanged, load);
  }, []);
  return setup;
}

function useFocus(): Focus {
  const [focus, setFocus] = useState<Focus>({
    cursor: null,
    pinnedWindowId: null,
  });
  useEffect(() => {
    const stopCursor = subscribe<Point>(EVENTS.pickerCursor, (cursor) =>
      setFocus({ cursor, pinnedWindowId: null }),
    );
    const stopPinned = subscribe<number>(
      EVENTS.windowPinned,
      (pinnedWindowId) =>
        setFocus((current) => ({ ...current, pinnedWindowId })),
    );
    return () => {
      stopCursor();
      stopPinned();
    };
  }, []);
  return focus;
}

/** Return records what's highlighted and Tab cycles windows, on the overlay under the cursor. */
function usePickerKeys(setup: Setup | null, view: PickerView | null) {
  usePickerKey((key) => {
    if (!setup || !view || view.mode === "area" || !view.hasCursor) return;
    const target = view.highlight?.target;
    if (key === "Enter" && target) void pick(target);
    if (key === "Tab" && view.mode === "window") {
      const currentId = target?.kind === "window" ? target.windowId : undefined;
      void emit(
        EVENTS.windowPinned,
        nextWindowId(setup.sources.windows, currentId),
      );
    }
  });
}
