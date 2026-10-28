import { describe, expect, test } from "bun:test";
import {
  ACTION_NAMES,
  actionFor,
  keyLabel,
  KEYMAP,
  paletteCommands,
  SHORTCUTS,
  type Binding,
} from "./keymap";
import { ALL_KINDS, KINDS, REGIONS } from "./regions";

const PRESS = {
  key: "",
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ctrlKey: false,
  repeat: false,
};

function pressOf({ key, meta = false, shift = false, alt = false }: Binding) {
  return { ...PRESS, key, metaKey: meta, shiftKey: shift, altKey: alt };
}

const BINDINGS = KEYMAP.map((binding) => [binding.action, binding] as const);

describe("keymap", () => {
  test.each(BINDINGS)("%s runs from its key", (action, binding) => {
    expect(actionFor(pressOf(binding))).toBe(action);
    if (/^[a-z]$/.test(binding.key) && binding.shift === undefined) {
      const shifted = {
        ...pressOf(binding),
        key: binding.key.toUpperCase(),
        shiftKey: true,
      };
      expect(actionFor(shifted)).toBe(action);
    }
  });

  test.each(BINDINGS)(
    "%s repeats while held only if it should",
    (action, binding) => {
      const held = { ...pressOf(binding), repeat: true };
      expect(actionFor(held)).toBe(binding.repeats ? action : null);
    },
  );

  test("⌘ only runs a binding that asks for it, and ⌃ belongs to the app's menus", () => {
    expect(actionFor({ ...PRESS, key: " ", metaKey: true })).toBeNull();
    expect(actionFor({ ...PRESS, key: "e" })).toBeNull();
    expect(actionFor({ ...PRESS, key: " ", ctrlKey: true })).toBeNull();
  });

  test("no modifier type's key is taken by a binding or another type", () => {
    for (const kind of ALL_KINDS)
      expect(actionFor({ ...PRESS, key: REGIONS[kind].key })).toBeNull();
    const keys = ALL_KINDS.map((kind) => REGIONS[kind].key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a key that isn't in the keymap does nothing", () => {
    expect(actionFor({ ...PRESS, key: "q" })).toBeNull();
  });

  test("no two bindings share a key", () => {
    const keys = KEYMAP.map(
      ({ key, meta, shift, alt }) =>
        `${meta ? "⌘" : ""}${shift ? "⇧" : ""}${alt ? "⌥" : ""}${key.toLowerCase()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("shortcuts sheet", () => {
  test("lists every binding exactly once", () => {
    const listed = SHORTCUTS.flatMap(({ rows }) =>
      rows.flatMap(({ actions = [] }) => actions),
    );
    expect(listed.sort()).toEqual(
      [...new Set(KEYMAP.map(({ action }) => action))].sort(),
    );
  });

  test.each([
    ["togglePlay", "Space"],
    ["stepBack", "←"],
    ["toEnd", "⌥→"],
    ["toggleLoop", "L"],
    ["leapForward", "⇧→"],
    ["openAdd", "/"],
    ["toggleCut", "C"],
    ["remove", "⌫"],
    ["selectAll", "⌘A"],
    ["deselect", "Esc"],
    ["export", "⌘E"],
    ["redo", "⇧⌘Z"],
    ["openPalette", "⌘K"],
  ] as const)("keyLabel(%p) is %p", (action, label) => {
    expect(keyLabel(action)).toBe(label);
  });
});

describe("command palette", () => {
  const commands = paletteCommands().flatMap(({ commands }) => commands);

  test("adds each ready modifier type with its key", () => {
    const adds = commands.flatMap((command) =>
      "kind" in command ? [[command.kind, command.keys]] : [],
    );
    expect(adds).toEqual(KINDS.map((kind) => [kind, REGIONS[kind].key]));
  });

  test("runs every other action once, named and with its shortcut", () => {
    const actions = commands.flatMap((command) =>
      "action" in command ? [command] : [],
    );
    expect(actions.map(({ action }) => action as string).sort()).toEqual(
      Object.keys(ACTION_NAMES)
        .filter((action) => action !== "openPalette" && action !== "openAdd")
        .sort(),
    );
    for (const { action, label, keys } of actions) {
      expect(label).toBe(ACTION_NAMES[action]);
      expect(keys).toBe(keyLabel(action));
    }
  });

  test("names are unique, so typing finds one of each", () => {
    const labels = commands.map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
