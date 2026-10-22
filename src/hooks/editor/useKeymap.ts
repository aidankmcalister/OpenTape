import { useEffect, useEffectEvent } from "react";
import { actionFor, type EditorAction } from "@/lib/editor/keymap";

/** The editor's one keydown listener. `actions` says what each action in the keymap does. */
export function useKeymap(actions: Record<EditorAction, () => void>) {
  // Always sees the latest `actions`, without adding the listener again every render.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const action = actionFor(event);
    if (!action) return;
    // Otherwise a focused button would also get the key, and Space would toggle it straight back.
    event.preventDefault();
    actions[action]();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
