import { useEffect, useEffectEvent } from "react";
import { actionFor, type EditorAction } from "@/lib/editor/keymap";

export function useKeymap(
  actions: Record<EditorAction, () => void>,
  onOtherKey: (key: string) => boolean,
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isTyping(event.target)) return;
    const action = actionFor(event);
    if (action) {
      event.preventDefault();
      actions[action]();
      return;
    }
    const isPlain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (isPlain && !event.repeat && onOtherKey(event.key))
      event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}
