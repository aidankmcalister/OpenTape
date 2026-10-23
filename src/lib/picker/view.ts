import { invoke } from "@tauri-apps/api/core";
import type { DisplayInfo, Session, Sources, Target } from "@/lib/bindings";
import {
  contains,
  intersect,
  relativeTo,
  type Point,
  type Rect,
  type Size,
} from "@/lib/geometry";

export const record = (target: Target) => invoke<void>("record", { target });

export type Highlight = {
  rect: Rect;
  covered: Rect[];
  barRect: Rect | null;
  title: string;
  icon: string | null;
  size: Size;
  target: Target;
};

export type PickerView =
  | { mode: "display" | "window"; highlight: Highlight | null }
  | { mode: "area"; display: DisplayInfo; hasBox: boolean };

export function pickerView(
  session: Session,
  cursor: Point | null,
  displayId: number,
): PickerView | null {
  const display = session.sources.displays.find(({ id }) => id === displayId);
  if (!display) return null;

  if (session.mode === "area") {
    return {
      mode: "area",
      display,
      hasBox: session.areaDisplayId === displayId,
    };
  }

  if (session.mode === "display") {
    if (!holdsCursor(display, cursor)) {
      return { mode: "display", highlight: null };
    }
    const highlight = highlightOf(display, display.frame, [], true, {
      title: display.name,
      icon: null,
      size: display.size,
      target: { kind: "display", displayId: display.id },
    });
    return { mode: "display", highlight };
  }

  const { windows, icons } = session.sources;
  const pinned = windows.find(({ id }) => id === session.pinnedWindowId);
  // Windows are ordered front to back, so the first under the cursor is the visible one.
  const window =
    pinned ??
    (cursor ? windows.find(({ frame }) => contains(frame, cursor)) : undefined);
  if (!window) return { mode: "window", highlight: null };
  const inFront = windows
    .slice(0, windows.indexOf(window))
    .map(({ frame }) => frame);
  const showsBar = pinned
    ? pinned.displayId === display.id
    : holdsCursor(display, cursor);
  const highlight = highlightOf(display, window.frame, inFront, showsBar, {
    title: window.app,
    icon: icons[window.pid] ?? null,
    size: window.size,
    target: { kind: "window", windowId: window.id },
  });
  return { mode: "window", highlight };
}

export function holdsCursor(
  display: DisplayInfo,
  cursor: Point | null,
): boolean {
  return cursor !== null && contains(display.frame, cursor);
}

function highlightOf(
  display: DisplayInfo,
  frame: Rect,
  inFront: Rect[],
  showsBar: boolean,
  about: Pick<Highlight, "title" | "icon" | "size" | "target">,
): Highlight {
  const rect = relativeTo(frame, display.frame);
  const screen = {
    x: 0,
    y: 0,
    width: display.frame.width,
    height: display.frame.height,
  };
  return {
    ...about,
    rect,
    covered: inFront
      .map((front) => intersect(front, frame))
      .filter((overlap) => overlap !== null)
      .map((overlap) => relativeTo(overlap, display.frame)),
    barRect: showsBar ? intersect(rect, screen) : null,
  };
}

export function nextWindowId(
  windows: Sources["windows"],
  currentId: number | undefined,
): number | undefined {
  const index = windows.findIndex(({ id }) => id === currentId);
  return windows[(index + 1) % windows.length]?.id;
}

export function sameHighlight(
  a: Highlight | null,
  b: Highlight | null,
): boolean {
  if (a === null || b === null) return a === b;
  const { icon: iconA, ...restA } = a;
  const { icon: iconB, ...restB } = b;
  return iconA === iconB && JSON.stringify(restA) === JSON.stringify(restB);
}

export function sameView(a: PickerView | null, b: PickerView | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.mode === "area" || b.mode === "area") {
    return (
      a.mode === "area" &&
      b.mode === "area" &&
      a.display === b.display &&
      a.hasBox === b.hasBox
    );
  }
  return a.mode === b.mode && sameHighlight(a.highlight, b.highlight);
}

export function pointerOnDisplay(
  session: Session | null,
  cursor: Point | null,
  displayId: number,
): Point | null {
  const display = session?.sources.displays.find(({ id }) => id === displayId);
  if (!cursor || !display) return null;
  return { x: cursor.x - display.frame.x, y: cursor.y - display.frame.y };
}
