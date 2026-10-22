/** What the editor's keys can do. The page says how each one is done. */
export type EditorAction =
  | "togglePlay"
  | "stepBack"
  | "stepForward"
  | "toStart"
  | "toEnd"
  | "toggleLoop"
  | "toggleSound"
  | "export";

export type Binding = {
  action: EditorAction;
  key: string;
  meta?: boolean;
  alt?: boolean;
  repeats?: boolean;
};

export const KEYMAP: Binding[] = [
  { action: "togglePlay", key: " " },
  { action: "stepBack", key: "ArrowLeft", repeats: true },
  { action: "stepForward", key: "ArrowRight", repeats: true },
  { action: "toStart", key: "ArrowLeft", alt: true },
  { action: "toEnd", key: "ArrowRight", alt: true },
  { action: "toggleLoop", key: "l" },
  { action: "toggleSound", key: "m" },
  { action: "export", key: "e", meta: true },
];

/**
 * The action a key press asks for, or null. ⌘ counts only for a binding that asks for it, so ⌘C
 * and the rest stay with the app's menus, and ⌃ always does. A letter works with or without Shift,
 * and holding a key repeats only where its binding says so.
 */
export function actionFor(
  press: Pick<
    KeyboardEvent,
    "key" | "altKey" | "metaKey" | "ctrlKey" | "repeat"
  >,
): EditorAction | null {
  if (press.ctrlKey) return null;
  const binding = KEYMAP.find(
    ({ key, meta = false, alt = false }) =>
      key.toLowerCase() === press.key.toLowerCase() &&
      meta === press.metaKey &&
      alt === press.altKey,
  );
  if (!binding || (press.repeat && !binding.repeats)) return null;
  return binding.action;
}
