import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Edits } from "@/hooks/editor/useProject";
import { FIXTURES, fixtureRegions } from "@/lib/editor/fixtures";

export default function DevPanel({
  edits,
  durationMs,
}: {
  edits: Edits;
  durationMs: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Dev settings" />
        }
      >
        <FlaskConical />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>Dev settings</PopoverTitle>
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted-foreground">
            Load a fixture
          </span>
          <div className="flex flex-wrap gap-1">
            {Object.entries(FIXTURES).map(([label, rows]) => (
              <Button
                key={label}
                variant="secondary"
                size="sm"
                onClick={() => {
                  edits.change((project) => ({
                    ...project,
                    regions: fixtureRegions(rows, durationMs),
                    clips: [],
                  }));
                  edits.select([]);
                  edits.setCutting(false);
                  setIsOpen(false);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
