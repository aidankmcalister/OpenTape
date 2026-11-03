import { invoke } from "@tauri-apps/api/core";
import type {
  DisplayInfo,
  Session,
  Sources,
  Target,
  WindowInfo,
} from "@/lib/bindings";
import {
  contains,
  intersect,
  relativeTo,
  type Point,
  type Rect,
  type RoundedRect,
  type Size,
} from "@/lib/geometry";

export const record = (target: Target) => invoke<void>("record", { target });

export type Highlight = {
  rect: RoundedRect;
  covered: RoundedRect[];
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
    const frame = { ...display.frame, corner: 0 };
    const highlight = highlightOf(display, frame, [], true, {
      title: display.name,
      icon: null,
      size: display.size,
      target: { kind: "display", displayId: display.id },
    });
    return { mode: "display", highlight };
  }

  const { windows, icons } = session.sources;
  const pinned = windows.find(({ id }) => id === session.pinnedWindowId);
  const window =
    pinned ??
    (cursor ? windows.find(({ frame }) => contains(frame, cursor)) : undefined);
  if (!window) return { mode: "window", highlight: null };
  const inFront = windows
    .slice(0, windows.indexOf(window))
    .filter((front) => front.pid !== window.pid || !isInside(front, window))
    .map(shapeOf);
  const showsBar = pinned
    ? pinned.displayId === display.id
    : holdsCursor(display, cursor);
  const highlight = highlightOf(display, shapeOf(window), inFront, showsBar, {
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

const shapeOf = ({ frame, corner }: WindowInfo) => ({ ...frame, corner });

function isInside(inner: WindowInfo, outer: WindowInfo): boolean {
  const overlap = intersect(inner.frame, outer.frame);
  return (
    overlap?.width === inner.frame.width &&
    overlap.height === inner.frame.height
  );
}

function highlightOf(
  display: DisplayInfo,
  frame: RoundedRect,
  inFront: RoundedRect[],
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
      .filter((front) => intersect(front, frame))
      .map((front) => relativeTo(front, display.frame)),
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
