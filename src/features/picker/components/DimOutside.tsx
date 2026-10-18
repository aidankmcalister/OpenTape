import type { Rect } from "@/lib/geometry";

/** Dims everything around `rect`. Plain rectangles, because a huge box-shadow doesn't render in the overlay. */
export default function DimOutside({ rect }: { rect: Rect }) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return (
    <>
      <div
        className="fixed inset-x-0 top-0 bg-dim"
        style={{ height: Math.max(rect.y, 0) }}
      />
      <div
        className="fixed inset-x-0 bottom-0 bg-dim"
        style={{ top: bottom }}
      />
      <div
        className="fixed left-0 bg-dim"
        style={{ top: rect.y, height: rect.height, width: Math.max(rect.x, 0) }}
      />
      <div
        className="fixed right-0 bg-dim"
        style={{ top: rect.y, height: rect.height, left: right }}
      />
    </>
  );
}
