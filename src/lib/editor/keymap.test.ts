import { describe, expect, test } from "bun:test";
import { actionFor, keyLabel, KEYMAP, SHORTCUTS, type Binding } from "./keymap";

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
      rows.flatMap(({ actions }) => actions),
    );
    expect(listed.sort()).toEqual(KEYMAP.map(({ action }) => action).sort());
  });

  test.each([
    ["togglePlay", "Space"],
    ["stepBack", "←"],
    ["toEnd", "⌥→"],
    ["toggleLoop", "L"],
    ["toggleCut", "C"],
    ["remove", "⌫"],
    ["export", "⌘E"],
    ["redo", "⇧⌘Z"],
  ] as const)("keyLabel(%p) is %p", (action, label) => {
    expect(keyLabel(action)).toBe(label);
  });
});
