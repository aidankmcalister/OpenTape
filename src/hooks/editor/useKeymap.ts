import { useEffect, useEffectEvent } from "react";
import { actionFor, type EditorAction } from "@/lib/editor/keymap";

export function useKeymap(actions: Record<EditorAction, () => void>) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const action = actionFor(event);
    if (!action) return;
    event.preventDefault();
    actions[action]();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
