import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

type PickerKey = "Enter" | "Tab";

/**
 * Return and Tab, but only the ones Rust sends to this overlay: the one holding the Area box,
 * or else the one under the cursor. Esc is handled entirely in Rust.
 */
export function usePickerKey(handler: (key: PickerKey) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<PickerKey>(
      "picker-key",
      ({ payload }) => latest.current(payload),
    );
    return () => void unlisten.then((stop) => stop());
  }, []);
}
