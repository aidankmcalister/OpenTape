import { ChevronDown, Proportions, SquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RATIOS, type Ratio } from "@/features/picker/lib/area";
import { cn } from "@/lib/utils";

const FREE = "free";

/** The Area's ratio chip and the menu it opens. The icon turns orange while a ratio is locked. */
export default function RatioChip({
  ratio,
  safeTop,
  onChoose,
}: {
  ratio: Ratio | null;
  /** The menu opens below the chip instead when it would reach under the menu bar or notch. */
  safeTop: number;
  onChoose: (ratio: Ratio | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="pill" className="group" />}
      >
        <Proportions className={cn(ratio && "text-highlight")} />
        {ratio?.label ?? "Free"}
        <ChevronDown className="text-muted-foreground transition-transform group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={{ top: safeTop + 8 }}
        className="w-44"
      >
        <DropdownMenuRadioGroup
          value={ratio?.label ?? FREE}
          onValueChange={(label) =>
            onChoose(RATIOS.find((choice) => choice.label === label) ?? null)
          }
        >
          <DropdownMenuRadioItem value={FREE}>
            <SquareDashed className="text-muted-foreground" />
            Free
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {RATIOS.map((choice) => (
            <DropdownMenuRadioItem key={choice.label} value={choice.label}>
              <RatioShape value={choice.value} />
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small outline in the ratio's own proportions. */
function RatioShape({ value }: { value: number }) {
  const longest = 13;
  return (
    <span className="grid size-4 place-items-center text-muted-foreground">
      <span
        className="rounded-[2px] border-[1.5px] border-current"
        style={{
          width: value >= 1 ? longest : longest * value,
          height: value >= 1 ? longest / value : longest,
        }}
      />
    </span>
  );
}
