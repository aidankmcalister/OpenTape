export type EditorAction =
  | "togglePlay"
  | "stepBack"
  | "stepForward"
  | "toStart"
  | "toEnd"
  | "toggleLoop"
  | "toggleSound"
  | "export"
  | "addZoom"
  | "removeRegion"
  | "undo"
  | "redo";

export type Binding = {
  action: EditorAction;
  key: string;
  meta?: boolean;
  shift?: boolean;
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
  { action: "addZoom", key: "z" },
  { action: "removeRegion", key: "Backspace" },
  { action: "undo", key: "z", meta: true, shift: false },
  { action: "redo", key: "z", meta: true, shift: true },
];

// ⌘ must match exactly, so ⌘C and the rest stay with the app's menus.
export function actionFor(
  press: Pick<
    KeyboardEvent,
    "key" | "altKey" | "metaKey" | "shiftKey" | "ctrlKey" | "repeat"
  >,
): EditorAction | null {
  if (press.ctrlKey) return null;
  const binding = KEYMAP.find(
    ({ key, meta = false, shift, alt = false }) =>
      key.toLowerCase() === press.key.toLowerCase() &&
      meta === press.metaKey &&
      (shift === undefined || shift === press.shiftKey) &&
      alt === press.altKey,
  );
  if (!binding || (press.repeat && !binding.repeats)) return null;
  return binding.action;
}
