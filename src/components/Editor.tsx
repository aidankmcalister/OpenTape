import {
  Folder,
  Trash,
  Upload,
  SkipBack,
  Play,
  SkipForward,
} from "lucide-react";
import { Button } from "./ui/button";
import { formatTime } from "@/lib/time";

export default function Editor() {
  return (
    <div className="flex h-screen flex-col bg-background">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center justify-between border-b pr-3 pl-20"
      >
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Recordings">
            <Folder />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Move to Trash">
            <Trash />
          </Button>
        </div>
        <span data-tauri-drag-region className="font-medium">
          Untitled recording
        </span>
        <Button size="sm">
          <Upload data-icon="inline-start" />
          Export
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex flex-1 flex-col">
          <div className="m-4 flex-1 rounded-xl border bg-card" />
          <div className="flex items-center justify-center gap-2 pb-3">
            <span className="text-muted-foreground tabular-nums">
              {formatTime(0)}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Skip back">
              <SkipBack />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Play">
              <Play />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Skip forward">
              <SkipForward />
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {formatTime(6350)}
            </span>
          </div>
        </main>
        <aside className="w-72 shrink-0 border-l bg-card" />
      </div>

      <footer className="h-40 shrink-0 border-t bg-card" />
    </div>
  );
}
