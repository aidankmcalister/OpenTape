import {
  contains,
  firstUnder,
  intersect,
  relativeTo,
  type Point,
  type Rect,
  type Size,
} from "./geometry";
import type { DisplayInfo, Setup, Sources } from "./picker";
import type { Target } from "./recording";

/** What's under the cursor, in the coordinates of the display drawing it. */
export type Highlight = {
  rect: Rect;
  /** Where the pill goes. Only the display holding the pointer or pinned window shows it. */
  label: Rect | null;
  title: string;
  /** The app's icon for windows. Displays have none. */
  icon: string | null;
  size: Size;
  target: Target;
};

export type PickerView =
  | {
      mode: "display" | "window";
      highlight: Highlight | null;
      /** The overlay under the cursor answers the keyboard, so only one acts. */
      hasCursor: boolean;
    }
  | { mode: "area"; display: DisplayInfo; startsHere: boolean };

/** A window pinned with Tab wins over the cursor until the cursor moves. */
export type Focus = { cursor: Point | null; pinnedWindowId: number | null };

type Subject = Pick<Highlight, "title" | "icon" | "target"> & { frame: Rect };

export function pickerView(
  setup: Setup,
  focus: Focus,
  displayId: number,
): PickerView | null {
  const display = setup.sources.displays.find(({ id }) => id === displayId);
  if (!display) return null;
  switch (setup.mode) {
    case "area":
      return {
        mode: "area",
        display,
        startsHere: startsOn(setup) === displayId,
      };
    case "display":
      return {
        mode: "display",
        highlight: displayHighlight(display, focus.cursor),
        hasCursor: isOn(display, focus.cursor),
      };
    case "window":
      return {
        mode: "window",
        highlight: windowHighlight(display, focus, setup.sources),
        hasCursor: isOn(display, focus.cursor),
      };
  }
}

export function nextWindowId(
  windows: Sources["windows"],
  currentId: number | undefined,
): number | undefined {
  const index = windows.findIndex(({ id }) => id === currentId);
  return windows[(index + 1) % windows.length]?.id;
}

function startsOn(setup: Setup): number | undefined {
  const { displays } = setup.sources;
  return (firstUnder(setup.cursor, displays) ?? displays[0])?.id;
}

function displayHighlight(
  display: DisplayInfo,
  cursor: Point | null,
): Highlight | null {
  if (!cursor || !isOn(display, cursor)) return null;
  const target: Target = { kind: "display", displayId: display.id };
  return highlightOf(
    { frame: display.frame, title: display.name, icon: null, target },
    display,
    cursor,
  );
}

function windowHighlight(
  display: DisplayInfo,
  focus: Focus,
  sources: Sources,
): Highlight | null {
  const pinned = sources.windows.find(({ id }) => id === focus.pinnedWindowId);
  const window = pinned ?? firstUnder(focus.cursor, sources.windows);
  const anchor = pinned ? centerOf(pinned.frame) : focus.cursor;
  if (!window || !anchor) return null;
  const target: Target = { kind: "window", windowId: window.id };
  const icon = sources.icons[window.pid] ?? null;
  return highlightOf(
    { frame: window.frame, title: window.app, icon, target },
    display,
    anchor,
  );
}

function highlightOf(
  { frame, ...subject }: Subject,
  display: DisplayInfo,
  anchor: Point,
): Highlight {
  const rect = relativeTo(frame, display.frame);
  const screen = {
    x: 0,
    y: 0,
    width: display.frame.width,
    height: display.frame.height,
  };
  return {
    ...subject,
    rect,
    label: contains(display.frame, anchor) ? intersect(rect, screen) : null,
    size: { width: Math.round(frame.width), height: Math.round(frame.height) },
  };
}

function isOn(display: DisplayInfo, cursor: Point | null): boolean {
  return cursor !== null && contains(display.frame, cursor);
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
