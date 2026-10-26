import { KINDS, REGIONS, type RegionKind } from "./regions";

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
  | "toggleCut"
  | "remove"
  | "openAdd"
  | "selectAll"
  | "deselect"
  | "undo"
  | "redo"
  | "openPalette"
  | "openSettings"
  | "openShortcuts"
  | "showBackground"
  | "showCursor"
  | "showSound";

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
  { action: "toggleCut", key: "c" },
  { action: "openAdd", key: "/" },
  { action: "remove", key: "Backspace" },
  { action: "remove", key: "Delete" },
  { action: "selectAll", key: "a", meta: true },
  { action: "deselect", key: "Escape" },
  { action: "undo", key: "z", meta: true, shift: false },
  { action: "redo", key: "z", meta: true, shift: true },
  { action: "openPalette", key: "k", meta: true },
];

export const ACTION_NAMES: Record<EditorAction, string> = {
  togglePlay: "Play or pause",
  stepBack: "Step back",
  stepForward: "Step forward",
  leapBack: "Leap back",
  leapForward: "Leap forward",
  toStart: "Jump to start",
  toEnd: "Jump to end",
  toggleLoop: "Loop",
  toggleSound: "Mute",
  toggleCut: "Cut tool",
  remove: "Delete selected",
  openAdd: "Search modifiers to add",
  selectAll: "Select every modifier",
  deselect: "Clear the selection",
  undo: "Undo",
  redo: "Redo",
  export: "Export",
  showBackground: "Background panel",
  showCursor: "Cursor panel",
  showSound: "Sound panel",
  openShortcuts: "Keyboard shortcuts",
  openSettings: "Settings",
  openPalette: "Command palette",
};

const ADDS = KINDS.map((kind) => ({
  label: `Add ${REGIONS[kind].label.toLowerCase()}`,
  keys: REGIONS[kind].key,
  kind,
}));

export type PaletteCommand = { label: string; keys: string } & (
  { action: EditorAction } | { kind: RegionKind }
);

export function paletteCommands(): {
  group: string;
  commands: PaletteCommand[];
}[] {
  const actions = Object.keys(ACTION_NAMES) as EditorAction[];
  return [
    { group: "Modifiers", commands: ADDS },
    {
      group: "Actions",
      commands: actions
        .filter((action) => action !== "openPalette" && action !== "openAdd")
        .map((action) => ({
          label: ACTION_NAMES[action],
          keys: keyLabel(action),
          action,
        })),
    },
  ];
}

export const SHORTCUTS: {
  group: string;
  rows: { label?: string; actions?: EditorAction[]; keys?: string[] }[];
}[] = [
  {
    group: "Playback",
    rows: [
      { actions: ["togglePlay"] },
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
      { actions: ["toggleLoop"] },
      { actions: ["toggleSound"] },
    ],
  },
  {
    group: "Editing",
    rows: [
      ...ADDS.map(({ label, keys }) => ({ label, keys: [keys] })),
      { label: "Open the focused modifier", keys: ["Enter"] },
      { label: "Next or previous modifier", keys: ["Tab", "⇧Tab"] },
      { label: "Modifier in the lane above or below", keys: ["↑", "↓"] },
      { actions: ["openAdd"] },
      { actions: ["toggleCut"] },
      { actions: ["remove"] },
      { actions: ["selectAll"] },
      { actions: ["deselect"] },
      { actions: ["undo"] },
      { actions: ["redo"] },
      { actions: ["export"] },
      { actions: ["openPalette"] },
    ],
  },
];

const KEY_NAMES: Record<string, string> = {
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
