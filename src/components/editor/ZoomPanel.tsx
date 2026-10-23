import { useRef, type PointerEvent } from "react";
import { Move, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Slider } from "@/components/ui/slider";
import type { Edits } from "@/hooks/editor/useProject";
import { changeRegion, REGIONS, type Region } from "@/lib/editor/regions";
import { editRegions } from "@/lib/editor/project";
import { focusAt, focusBox, MIDDLE, ZOOM_AMOUNTS } from "@/lib/editor/zoom";
import { PanelHeader, Section } from "./Panel";

export default function ZoomPanel({ edits }: { edits: Edits }) {
  const zoom = edits.selected?.kind === "zoom" ? edits.selected : null;
  if (!zoom) {
    return (
      <>
        <PanelHeader title="Zoom" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="mb-1 grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <ZoomIn />
          </div>
          <p className="text-ui font-semibold">No zoom selected</p>
          <p className="text-caption text-muted-foreground">
            Press Z to add one at the playhead.
          </p>
        </div>
      </>
    );
  }
  const preview = (change: Partial<Region>) =>
    edits.preview((project) =>
      editRegions(project, (regions) => changeRegion(regions, zoom.id, change)),
    );
  const commit = (change: Partial<Region>) =>
    edits.change((project) =>
      editRegions(project, (regions) => changeRegion(regions, zoom.id, change)),
    );
  return (
    <>
      <PanelHeader
        title="Zoom"
        onReset={() => commit({ amount: REGIONS.zoom.amount, center: MIDDLE })}
      />
      <Section title="Zoom">
        <Slider
          variant="field"
          {...ZOOM_AMOUNTS}
          value={[zoom.amount]}
          onValueChange={(next) => preview({ amount: Number(next) })}
          onValueCommitted={edits.commit}
        >
          <span>Amount</span>
          <span className="font-mono font-medium">
            {zoom.amount.toFixed(1)}×
          </span>
        </Slider>
      </Section>
      <Section
        title="Focus"
        action={
          <Button
            variant="ghost"
            size="xs"
            onClick={() => commit({ center: MIDDLE })}
          >
            Center
          </Button>
        }
      >
        <FocusBox
          zoom={zoom}
          onMove={(center) => preview({ center })}
          onDone={edits.commit}
        />
        <span className="text-caption text-muted-foreground">
          Drag the box to choose where it zooms.
        </span>
      </Section>
      <div className="mt-auto p-3">
        <Button
          variant="secondary"
          className="w-full text-ui"
          onClick={edits.removeRegion}
        >
          Delete zoom
          <Kbd>⌫</Kbd>
        </Button>
      </div>
    </>
  );
}

function FocusBox({
  zoom,
  onMove,
  onDone,
}: {
  zoom: Region;
  onMove: (center: { x: number; y: number }) => void;
  onDone: () => void;
}) {
  const drag = useRef<{ x: number; y: number; width: number; height: number }>(
    null,
  );
  const box = focusBox(zoom);
  const move = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (!from || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const start = focusBox(zoom);
    onMove(
      focusAt(
        {
          x: start.x + (event.clientX - from.x) / from.width,
          y: start.y + (event.clientY - from.y) / from.height,
        },
        zoom.amount,
      ),
    );
    drag.current = { ...from, x: event.clientX, y: event.clientY };
  };
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border border-hairline bg-secondary dot-grid">
      <div
        className="absolute grid cursor-grab place-items-center rounded-sm border-2 border-highlight bg-highlight/16 active:cursor-grabbing"
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.size * 100}%`,
          height: `${box.size * 100}%`,
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const area =
            event.currentTarget.parentElement!.getBoundingClientRect();
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            width: area.width,
            height: area.height,
          };
        }}
        onPointerMove={move}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onDone();
        }}
      >
        <div className="grid size-6 place-items-center rounded-full bg-highlight text-primary-foreground">
          <Move className="size-3.5" />
        </div>
      </div>
    </div>
  );
}
