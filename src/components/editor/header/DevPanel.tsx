import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Dev } from "@/hooks/editor/useDevFlags";
import type { Edits } from "@/hooks/editor/useProject";
import { FIXTURES, fixtureRegions } from "@/lib/editor/fixtures";

export default function DevPanel({
  dev,
  edits,
  durationMs,
}: {
  dev: Dev;
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
            Preview types in the Add menu
          </span>
          <Tabs
            value={dev.previewTypes ? "shown" : "hidden"}
            onValueChange={(value) => dev.setPreviewTypes(value === "shown")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="hidden">Hidden</TabsTrigger>
              <TabsTrigger value="shown">Shown</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
