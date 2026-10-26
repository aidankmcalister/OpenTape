import type { ReactNode } from "react";
import { Image, MousePointer2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Edits } from "@/hooks/editor/useProject";
import type { AppSettings } from "@/hooks/useAppSettings";
import type { SoundTrack } from "@/lib/bindings";
import type { CursorTrack } from "@/lib/editor/cursor";
import Island from "../Island";
import SettingsDialog from "./SettingsDialog";
import ShortcutsSheet from "./ShortcutsSheet";
import AppearancePanel from "./AppearancePanel";
import CursorPanel from "./CursorPanel";
import SoundPanel from "./SoundPanel";

const PANELS = [
  { id: "background", label: "Background", Icon: Image },
  { id: "cursor", label: "Cursor", Icon: MousePointer2 },
  { id: "sound", label: "Sound", Icon: Volume2 },
] as const;

export type SidebarPanel = (typeof PANELS)[number]["id"];
export type EditorDialog = "palette" | "settings" | "shortcuts";

export default function Sidebar({
  edits,
  cursor,
  app,
  sound,
  panel,
  onPanelChange,
  dialog,
  onDialogChange,
}: {
  edits: Edits;
  cursor: CursorTrack;
  app: AppSettings;
  sound: SoundTrack[] | null;
  panel: SidebarPanel;
  onPanelChange: (panel: SidebarPanel) => void;
  dialog: EditorDialog | null;
  onDialogChange: (dialog: EditorDialog | null) => void;
}) {
  const dialogProps = (id: EditorDialog) => ({
    open: dialog === id,
    onOpenChange: (open: boolean) => onDialogChange(open ? id : null),
  });
  return (
    <Island className="flex w-86 shrink-0">
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 py-3 hairline-r">
        {PANELS.map(({ id, label, Icon }) => (
          <RailTip key={id} label={label}>
            <Button
              variant={id === panel ? "selected" : "ghost"}
              size="icon"
              aria-label={label}
              aria-pressed={id === panel}
              onClick={() => onPanelChange(id)}
            >
              <Icon />
            </Button>
          </RailTip>
        ))}
        <Separator className="mt-auto mb-1 w-6" />
        <RailTip label="Keyboard shortcuts">
          <ShortcutsSheet {...dialogProps("shortcuts")} />
        </RailTip>
        <RailTip label="GitHub">
          <Button variant="ghost" size="icon" aria-label="GitHub" disabled>
            <GitHubMark />
          </Button>
        </RailTip>
        <RailTip label="Settings">
          <SettingsDialog
            {...dialogProps("settings")}
            app={app}
            appearance={edits.project.appearance}
          />
        </RailTip>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {panel === "cursor" ? (
          <CursorPanel edits={edits} track={cursor} />
        ) : panel === "sound" ? (
          <SoundPanel edits={edits} tracks={sound} />
        ) : (
          <AppearancePanel edits={edits} />
        )}
      </div>
    </Island>
  );
}

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
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
