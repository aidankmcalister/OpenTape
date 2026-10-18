import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";

type Choice<T> = { value: T; label: string };
type Action = { label: string; run: () => void } | "separator";

/** A native menu under `anchor`, with a check next to the selected choice. */
export async function popupChoices<T>(
  anchor: HTMLElement,
  choices: Choice<T>[],
  selected: T,
  onChoose: (value: T) => void,
) {
  const items = await Promise.all(
    choices.map(({ value, label }) =>
      CheckMenuItem.new({
        text: label,
        checked: value === selected,
        action: () => onChoose(value),
      }),
    ),
  );
  await popupBelow(anchor, await Menu.new({ items }));
}

export async function popupActions(anchor: HTMLElement, actions: Action[]) {
  const items = await Promise.all(
    actions.map((action) =>
      action === "separator"
        ? PredefinedMenuItem.new({ item: "Separator" })
        : MenuItem.new({ text: action.label, action: action.run }),
    ),
  );
  await popupBelow(anchor, await Menu.new({ items }));
}

// Native menus, because the bar window is too short to hold a web dropdown.
async function popupBelow(anchor: HTMLElement, menu: Menu) {
  const { left, bottom } = anchor.getBoundingClientRect();
  await menu.popup(new LogicalPosition(left, bottom + 6));
}
