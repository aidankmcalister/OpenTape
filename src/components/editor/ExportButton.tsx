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
          <div className="flex w-41.5 items-center justify-between pr-3">
            <PillMessage icon={<Spinner />}>Exporting</PillMessage>
            <span className="text-ui font-medium tabular-nums">
              {Math.round(progress * 100)}%
            </span>
          </div>
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
