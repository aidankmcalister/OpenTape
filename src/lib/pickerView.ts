import {
  contains,
  firstUnder,
  intersect,
  relativeTo,
  type Point,
  type Rect,
  type Size,
} from "./geometry";
import type { DisplayInfo, Session, Sources } from "./picker";
import type { Target } from "./recording";

/** What's under the cursor, in the coordinates of the display drawing it. */
export type Highlight = {
  rect: Rect;
  /** The parts of `rect` that windows in front of it cover, which the tint leaves out. */
  covered: Rect[];
  /** Where the pill goes. Only the display holding the pointer or pinned window shows it. */
  label: Rect | null;
  title: string;
  /** The app's icon for windows. Displays have none. */
  icon: string | null;
  /** What the recording will be, in pixels. */
  size: Size;
  target: Target;
};

export type PickerView =
  | { mode: "display" | "window"; highlight: Highlight | null }
  | { mode: "area"; display: DisplayInfo; hasBox: boolean };

type Subject = Pick<Highlight, "title" | "icon" | "size" | "target"> & {
  frame: Rect;
  /** Frames of the windows in front of it. */
  inFront: Rect[];
};

export function pickerView(
  session: Session,
  cursor: Point | null,
  displayId: number,
): PickerView | null {
  const display = session.sources.displays.find(({ id }) => id === displayId);
  if (!display) return null;
  switch (session.mode) {
    case "area":
      return {
        mode: "area",
        display,
        hasBox: session.areaDisplayId === displayId,
      };
    case "display":
      return { mode: "display", highlight: displayHighlight(display, cursor) };
    case "window":
      return {
        mode: "window",
        highlight: windowHighlight(display, cursor, session),
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

function displayHighlight(
  display: DisplayInfo,
  cursor: Point | null,
): Highlight | null {
  if (!cursor || !contains(display.frame, cursor)) return null;
  const target: Target = { kind: "display", displayId: display.id };
  return highlightOf(
    {
      frame: display.frame,
      inFront: [],
      title: display.name,
      icon: null,
      size: display.size,
      target,
    },
    display,
    cursor,
  );
}

function windowHighlight(
  display: DisplayInfo,
  cursor: Point | null,
  { sources, pinnedWindowId }: Session,
): Highlight | null {
  const pinned = sources.windows.find(({ id }) => id === pinnedWindowId);
  const window = pinned ?? firstUnder(cursor, sources.windows);
  const anchor = pinned ? centerOf(pinned.frame) : cursor;
  if (!window || !anchor) return null;
  const target: Target = { kind: "window", windowId: window.id };
  const icon = sources.icons[window.pid] ?? null;
  const inFront = sources.windows
    .slice(0, sources.windows.indexOf(window))
    .map(({ frame }) => frame);
  return highlightOf(
    {
      frame: window.frame,
      inFront,
      title: window.app,
      icon,
      size: window.size,
      target,
    },
    display,
    anchor,
  );
}

function highlightOf(
  { frame, inFront, ...subject }: Subject,
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
  const covered = inFront
    .map((front) => intersect(front, frame))
    .filter((overlap) => overlap !== null)
    .map((overlap) => relativeTo(overlap, display.frame));
  return {
    ...subject,
    rect,
    covered,
    label: contains(display.frame, anchor) ? intersect(rect, screen) : null,
  };
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Whether two highlights draw the same. The cursor streams in 60 times a second, but the
 * highlight only changes when it crosses into another window, so the overlay redraws only then.
 */
export function sameHighlight(
  a: Highlight | null,
  b: Highlight | null,
): boolean {
  if (a === null || b === null) return a === b;
  const { icon: iconA, ...restA } = a;
  const { icon: iconB, ...restB } = b;
  return iconA === iconB && JSON.stringify(restA) === JSON.stringify(restB);
}
