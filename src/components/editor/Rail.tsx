import type { ComponentType } from "react";
import {
  Captions,
  CircleHelp,
  Image,
  Keyboard,
  MousePointer2,
  SlidersHorizontal,
  Volume2,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type Tool = { label: string; Icon: ComponentType<{ className?: string }> };

/** Only Background has a panel so far; the rest are shown disabled so the layout is final. */
const PANELS: Tool[] = [
  { label: "Background", Icon: Image },
  { label: "Cursor", Icon: MousePointer2 },
  { label: "Zoom", Icon: ZoomIn },
  { label: "Audio", Icon: Volume2 },
  { label: "Captions", Icon: Captions },
];

const FOOTER: Tool[] = [
  { label: "Shortcuts", Icon: Keyboard },
  { label: "Help", Icon: CircleHelp },
  { label: "Settings", Icon: SlidersHorizontal },
];

export default function Rail() {
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-hairline py-2">
      {PANELS.map((tool, index) => (
        <RailButton key={tool.label} tool={tool} isActive={index === 0} />
      ))}
      <Separator className="my-1 w-6 bg-hairline" />
      <div className="mt-auto flex flex-col gap-1">
        {FOOTER.map((tool) => (
          <RailButton key={tool.label} tool={tool} isActive={false} />
        ))}
      </div>
    </nav>
  );
}

function RailButton({ tool, isActive }: { tool: Tool; isActive: boolean }) {
  const { label, Icon } = tool;
  return (
    <Button
      variant={isActive ? "selected" : "ghost"}
      size="icon"
      aria-label={label}
      aria-pressed={isActive}
      disabled={!isActive}
    >
      <Icon />
    </Button>
  );
}
