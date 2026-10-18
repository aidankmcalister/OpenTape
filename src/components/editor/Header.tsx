import { Redo2, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * The title bar: what's open, a search for actions, and Export. The traffic lights are macOS's
 * own, inset to sit in the left gap. Search, undo, redo and Export come later.
 */
export default function Header({ name }: { name: string | null }) {
  return (
    <header
      data-tauri-drag-region
      className="relative flex h-10 shrink-0 items-center px-4 text-xs font-medium"
    >
      {name && (
        <p data-tauri-drag-region className="pl-17 text-muted-foreground">
          Unsaved <span className="px-1 text-faint">/</span>
          <span className="text-foreground">{name}</span>
          <span className="text-faint">.mp4</span>
        </p>
      )}
      <Button
        variant="outline"
        size="pill-sm"
        disabled
        className="absolute left-1/2 w-90 -translate-x-1/2 justify-start"
      >
        <Search data-icon="inline-start" />
        <span className="flex-1 text-left">Search actions</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Undo" disabled>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" disabled>
          <Redo2 />
        </Button>
        <Button size="pill-sm" className="ml-3" disabled>
          Export
          <Kbd>⌘E</Kbd>
        </Button>
      </div>
    </header>
  );
}
