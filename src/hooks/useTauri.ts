import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PageEvent } from "@/lib/bindings";

type EventName = PageEvent["event"];
type Payload<E extends EventName> =
  Extract<PageEvent, { event: E }> extends { payload: infer P } ? P : null;

export function useTauriEvent<E extends EventName>(
  event: E,
  handler: (payload: Payload<E>) => void,
  scope: "any" | "window" = "any",
) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    // Listening is async, so an event can arrive after unmount, including StrictMode's first mount.
    let isMounted = true;
    const onEvent = ({ payload }: { payload: Payload<E> }) => {
      if (isMounted) latest.current(payload);
    };
    const unlisten =
      scope === "window"
        ? getCurrentWebviewWindow().listen(event, onEvent)
        : listen(event, onEvent);
    unlisten.catch(console.error);
    return () => {
      isMounted = false;
      unlisten.then((stop) => stop()).catch(console.error);
    };
  }, [event, scope]);
}

export function useInvokeOnMount<T>(
  command: string,
  onResult: (result: T) => void,
) {
  const latest = useRef(onResult);
  useLayoutEffect(() => {
    latest.current = onResult;
  });

  useEffect(() => {
    let isMounted = true;
    invoke<T>(command)
      .then((result) => {
        if (isMounted) latest.current(result);
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, [command]);
}

export function useRustValue<E extends EventName>(
  command: string,
  event: E,
  onValue: (value: Payload<E>) => void,
  scope: "any" | "window" = "any",
) {
  const [order] = useState(latestWins);
  useInvokeOnMount<Payload<E>>(command, (first) =>
    order.answer(first, onValue),
  );
  useTauriEvent(event, (next) => order.event(next, onValue), scope);
}

// The first answer can arrive after a newer event, so then it's dropped.
export function latestWins() {
  let hasEvent = false;
  return {
    answer<T>(value: T, apply: (value: T) => void) {
      if (!hasEvent) apply(value);
    },
    event<T>(value: T, apply: (value: T) => void) {
      hasEvent = true;
      apply(value);
    },
  };
}

export function oneAtATime() {
  let isRunning = false;
  return async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    if (isRunning) return undefined;
    isRunning = true;
    try {
      return await job();
    } finally {
      isRunning = false;
    }
  };
}

export function useOneAtATime() {
  const [run] = useState(oneAtATime);
  return run;
}
