type Pressed = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const MODIFIERS = [
  { held: "ctrlKey", name: "Control", symbol: "⌃" },
  { held: "altKey", name: "Alt", symbol: "⌥" },
  { held: "shiftKey", name: "Shift", symbol: "⇧" },
  { held: "metaKey", name: "Super", symbol: "⌘" },
] as const;

export function shortcutFromKey(pressed: Pressed): string | null {
  const isModifier = /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(
    pressed.code,
  );
  const hasModifier = pressed.ctrlKey || pressed.altKey || pressed.metaKey;
  if (isModifier || !hasModifier) return null;
  const held = MODIFIERS.filter(({ held }) => pressed[held]);
  return [...held.map(({ name }) => name), pressed.code].join("+");
}

export function shortcutLabel(shortcut: string): string {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const symbols = MODIFIERS.filter(({ name }) => parts.includes(name));
  return (
    symbols.map(({ symbol }) => symbol).join("") +
    key.replace(/^(Key|Digit)/, "")
  );
}
