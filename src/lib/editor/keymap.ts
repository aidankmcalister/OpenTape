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
  | "addSpeed"
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
  { action: "addSpeed", key: "s" },
  { action: "removeRegion", key: "Backspace" },
  { action: "undo", key: "z", meta: true, shift: false },
  { action: "redo", key: "z", meta: true, shift: true },
];

export const SHORTCUTS: {
  group: string;
  rows: { label: string; actions: EditorAction[] }[];
}[] = [
  {
    group: "Playback",
    rows: [
      { label: "Play or pause", actions: ["togglePlay"] },
      { label: "Step one frame", actions: ["stepBack", "stepForward"] },
      { label: "Jump to start or end", actions: ["toStart", "toEnd"] },
      { label: "Loop", actions: ["toggleLoop"] },
      { label: "Mute", actions: ["toggleSound"] },
    ],
  },
  {
    group: "Editing",
    rows: [
      { label: "Add a zoom", actions: ["addZoom"] },
      { label: "Add a speed region", actions: ["addSpeed"] },
      { label: "Delete selected zoom", actions: ["removeRegion"] },
      { label: "Undo", actions: ["undo"] },
      { label: "Redo", actions: ["redo"] },
      { label: "Export", actions: ["export"] },
    ],
  },
];

export const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "⌫",
};

export function keyLabel(action: EditorAction): string {
  const binding = KEYMAP.find((binding) => binding.action === action);
  if (!binding) return "";
  const { key, alt, shift, meta } = binding;
  const name = KEY_NAMES[key] ?? key.toUpperCase();
  return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${meta ? "⌘" : ""}${name}`;
}

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
