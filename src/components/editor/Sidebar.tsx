import { useState } from "react";
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
import type { Edits } from "@/hooks/editor/useProject";
import Island from "./Island";
import AppearancePanel from "./AppearancePanel";
import ZoomPanel from "./ZoomPanel";

const PANELS = [
  { id: "background", label: "Background", Icon: Image },
  { id: "cursor", label: "Cursor", Icon: MousePointer2 },
  { id: "zoom", label: "Zoom", Icon: ZoomIn },
  { id: "audio", label: "Audio", Icon: Volume2 },
  { id: "captions", label: "Captions", Icon: Captions },
];

const BUILT = ["background", "zoom"];

const LINKS = [
  { label: "Keyboard shortcuts", Icon: Keyboard },
  { label: "Help", Icon: CircleHelp },
  { label: "GitHub", Icon: GitHubMark },
  { label: "Settings", Icon: SlidersHorizontal },
];

export default function Sidebar({ edits }: { edits: Edits }) {
  const [panel, setPanel] = useState("background");
  const [shownId, setShownId] = useState(edits.selectedId);

  if (edits.selectedId !== shownId) {
    setShownId(edits.selectedId);
    if (edits.selected?.kind === "zoom") setPanel("zoom");
  }

  return (
    <Island className="flex w-86 shrink-0">
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-hairline py-3">
        {PANELS.map(({ id, label, Icon }) => (
          <Button
            key={id}
            variant={id === panel ? "selected" : "ghost"}
            size="icon-round"
            aria-label={label}
            disabled={!BUILT.includes(id)}
            onClick={() => setPanel(id)}
          >
            <Icon />
          </Button>
        ))}
        <Separator className="mt-auto mb-1 w-6" />
        {LINKS.map(({ label, Icon }) => (
          <Button
            key={label}
            variant="ghost"
            size="icon-round"
            aria-label={label}
            disabled
          >
            <Icon />
          </Button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {panel === "zoom" ? (
          <ZoomPanel edits={edits} />
        ) : (
          <AppearancePanel edits={edits} />
        )}
      </div>
    </Island>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}
