import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { EventName } from "@/lib/events";

/**
 * Calls `handler` with each payload of a Rust event while the component is mounted. With
 * "window", it hears only events sent to this window; otherwise it hears the event wherever it
 * was sent. The latest `handler` is always called, without listening again.
 */
export function useTauriEvent<T>(
  event: EventName,
  handler: (payload: T) => void,
  scope: "any" | "window" = "any",
) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    // Listening is async, so an event can still arrive between unmount and the unlisten
    // resolving. That includes StrictMode's first mount, which would otherwise hear it twice.
    let isMounted = true;
    const onEvent = ({ payload }: { payload: T }) => {
      if (isMounted) latest.current(payload);
    };
    const unlisten =
      scope === "window"
        ? getCurrentWebviewWindow().listen<T>(event, onEvent)
        : listen<T>(event, onEvent);
    unlisten.catch(console.error);
    return () => {
      isMounted = false;
      unlisten.then((stop) => stop()).catch(console.error);
    };
  }, [event, scope]);
}
