import type { ExportState } from "@/hooks/editor/useExport";
import { Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { MorphPill, PillMessage } from "@/components/Pill";

export default function ExportButton({
  state,
  onExport,
  onShowInFinder,
}: {
  state: ExportState;
  onExport: (() => void) | null;
  onShowInFinder: () => void;
}) {
  const progress = state.stage === "exporting" ? state.progress : 1;
  const reason = state.stage === "failed" ? state.reason : undefined;
  return (
    <MorphPill
      active={state.stage}
      className="border-transparent bg-primary text-primary-foreground"
      layers={{
        idle: (
          <Button
            variant="primary"
            size="pill-sm"
            disabled={!onExport}
            onClick={onExport ?? undefined}
          >
            Export
            <Kbd>⌘E</Kbd>
          </Button>
        ),
        exporting: (
          <PillMessage icon={<Spinner />}>
            Exporting
            {/* As wide as "100%" all the way, so the pill keeps one width while it counts. */}
            <span className="-ml-1 grid tabular-nums">
              <span className="invisible col-start-1 row-start-1">100%</span>
              <span className="col-start-1 row-start-1">
                {Math.round(progress * 100)}%
              </span>
            </span>
          </PillMessage>
        ),
        done: (
          <>
            <PillMessage icon={<Check />}>Exported</PillMessage>
            <Button
              variant="primary"
              size="xs"
              className="mr-1 rounded-full bg-primary-foreground/20 hover:bg-primary-foreground/30"
              onClick={onShowInFinder}
            >
              Show in Finder
            </Button>
          </>
        ),
        failed: (
          <span title={reason}>
            <PillMessage icon={<CircleAlert />}>Export failed</PillMessage>
          </span>
        ),
      }}
    />
  );
}
