import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PageEvent } from "@/lib/bindings";

/** Every event Rust sends the pages. */
type EventName = PageEvent["event"];
/** What `event` carries, read from Rust's `PageEvent`, or null when it carries nothing. */
type Payload<E extends EventName> =
  Extract<PageEvent, { event: E }> extends { payload: infer P } ? P : null;

/**
 * Calls the latest `handler` with each payload of a Rust event while mounted. With "window", it
 * hears only events sent to this window.
 */
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
    // Listening is async, so an event can still arrive between unmount and the unlisten
    // resolving. That includes StrictMode's first mount, which would otherwise hear it twice.
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

/**
 * Invokes `command` once on mount and hands the answer to the latest `onResult`, unless the
 * component unmounted first, as StrictMode's first mount does.
 */
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

/**
 * Hands `onValue` the current value of something Rust owns: `command`'s answer on mount, then
 * each `event`. Rust answers `command` with what `event` carries.
 */
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

/**
 * Orders a first ask's answer and the events after it. The answer can arrive after an event, and
 * is older then, so it's dropped.
 */
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

/**
 * Lets one async job run at a time, for actions a double click, a held key or a second listener
 * could start twice. A job started while another is running is dropped, and gives undefined.
 */
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

/** A `oneAtATime` gate that lives as long as the component. */
export function useOneAtATime() {
  const [run] = useState(oneAtATime);
  return run;
}
