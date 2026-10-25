export type EditorAction =
  | "togglePlay"
  | "stepBack"
  | "stepForward"
  | "leapBack"
  | "leapForward"
  | "toStart"
  | "toEnd"
  | "toggleLoop"
  | "toggleSound"
  | "export"
  | "addZoom"
  | "addSpeed"
  | "toggleCut"
  | "remove"
  | "openAdd"
  | "selectAll"
  | "deselect"
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
  { action: "stepBack", key: "ArrowLeft", shift: false, repeats: true },
  { action: "stepForward", key: "ArrowRight", shift: false, repeats: true },
  { action: "leapBack", key: "ArrowLeft", shift: true, repeats: true },
  { action: "leapForward", key: "ArrowRight", shift: true, repeats: true },
  { action: "toStart", key: "ArrowLeft", alt: true },
  { action: "toEnd", key: "ArrowRight", alt: true },
  { action: "toggleLoop", key: "l" },
  { action: "toggleSound", key: "m" },
  { action: "export", key: "e", meta: true },
  { action: "addZoom", key: "z" },
  { action: "addSpeed", key: "s" },
  { action: "toggleCut", key: "c" },
  { action: "openAdd", key: "/" },
  { action: "remove", key: "Backspace" },
  { action: "remove", key: "Delete" },
  { action: "selectAll", key: "a", meta: true },
  { action: "deselect", key: "Escape" },
  { action: "undo", key: "z", meta: true, shift: false },
  { action: "redo", key: "z", meta: true, shift: true },
];

export const SHORTCUTS: {
  group: string;
  rows: { label: string; actions?: EditorAction[]; keys?: string[] }[];
}[] = [
  {
    group: "Playback",
    rows: [
      { label: "Play or pause", actions: ["togglePlay"] },
      {
        label: "Step one frame, or nudge the selection 0.1s",
        actions: ["stepBack", "stepForward"],
      },
      {
        label: "Step one second, or nudge the selection 1s",
        actions: ["leapBack", "leapForward"],
      },
      {
        label: "Jump to start or end, or move the selection's end",
        actions: ["toStart", "toEnd"],
      },
      { label: "Loop", actions: ["toggleLoop"] },
      { label: "Mute", actions: ["toggleSound"] },
    ],
  },
  {
    group: "Editing",
    rows: [
      { label: "Add a zoom", actions: ["addZoom"] },
      { label: "Add a speed region", actions: ["addSpeed"] },
      { label: "Open the focused modifier", keys: ["Enter"] },
      { label: "Next or previous modifier", keys: ["Tab", "⇧Tab"] },
      { label: "Modifier in the lane above or below", keys: ["↑", "↓"] },
      { label: "Search modifiers to add", actions: ["openAdd"] },
      { label: "Cut tool", actions: ["toggleCut"] },
      { label: "Delete selected", actions: ["remove"] },
      { label: "Select every modifier", actions: ["selectAll"] },
      { label: "Clear the selection", actions: ["deselect"] },
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
  Escape: "Esc",
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
