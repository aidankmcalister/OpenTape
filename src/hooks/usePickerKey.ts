import { useEffect, useRef } from "react";
import { EVENTS, subscribe } from "@/lib/events";

export type PickerKey = "Enter" | "Tab";

/** Return and Tab while picking, always calling the latest `handler`. Esc is handled in Rust. */
export function usePickerKey(handler: (key: PickerKey) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () => subscribe<PickerKey>(EVENTS.pickerKey, (key) => latest.current(key)),
    [],
  );
}
