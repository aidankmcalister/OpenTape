import type { ComponentProps } from "react";
import {
  Captions,
  CircleHelp,
  Image,
  Keyboard,
  MousePointer2,
  Redo2,
  Search,
  SlidersHorizontal,
  Undo2,
  Volume2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { useClockValue } from "@/hooks/useVideoClock";
import { rectStyle } from "@/lib/geometry";
import { cn } from "@/lib/utils";
import BackgroundPanel from "./BackgroundPanel";
import { fillCss, frameLayout, outputAt, ZOOM_EASE, zoomAt } from "./edits";
import Timeline from "./Timeline";
import {
  useEditor,
  useElementSize,
  useOpenedRecording,
  type Editor as EditorState,
} from "./useEditor";

export default function Editor() {
  const recording = useOpenedRecording();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground select-none">
      <Header name={recording?.name ?? null} />
      {recording ? (
        <Workspace key={recording.videoSrc} videoSrc={recording.videoSrc} />
      ) : (
        <div className="grid flex-1 place-items-center text-sm text-faint">
          No recording open
        </div>
      )}
    </div>
  );
}

/** Keyed by the recording, so opening another one starts fresh. */
function Workspace({ videoSrc }: { videoSrc: string }) {
  const editor = useEditor(videoSrc);
  return (
    <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
      <Island className="flex w-86 shrink-0">
        <Rail />
        <BackgroundPanel editor={editor} />
      </Island>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Stage editor={editor} />
        <Island className="h-38 shrink-0">
          <Timeline editor={editor} />
        </Island>
      </div>
    </div>
  );
}

/** A rounded panel of the editor, like the stage or the timeline. */
function Island({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-hairline bg-island",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The traffic lights are macOS's own, inset to sit in the left gap. Search, undo, redo and Export
 * come later.
 */
function Header({ name }: { name: string | null }) {
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

type Tool = { label: string; Icon: LucideIcon };

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

function Rail() {
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

function RailButton({
  tool: { label, Icon },
  isActive,
}: {
  tool: Tool;
  isActive: boolean;
}) {
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

/**
 * The recording framed the way it will export. The zoom it eases toward changes only at a region's
 * edge, so the stage redraws only then, and CSS eases it with the same curve `zoomAt` uses.
 */
function Stage({ editor }: { editor: EditorState }) {
  const { ref: canvasRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const { look, regions, playback } = editor;
  const ratio = playback.videoSize
    ? playback.videoSize.width / playback.videoSize.height
    : 16 / 9;
  const { frame, recording, radius, shadow, border, video } = frameLayout(
    look,
    canvasSize,
    ratio,
  );
  const zoomAtPlayhead = (seconds: number) =>
    zoomAt(regions, outputAt(regions, seconds * 1000));
  const zoom = useClockValue(playback.clock, (s) => zoomAtPlayhead(s).target);
  const centre = useClockValue(playback.clock, (s) => zoomAtPlayhead(s).centre);

  return (
    <Island className="relative min-h-0 flex-1 bg-canvas">
      <div
        ref={canvasRef}
        className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle,rgb(255_255_255/0.07)_1px,transparent_1px)] bg-size-[16px_16px] bg-position-[8px_8px]"
      >
        <div
          className="relative grid place-items-center overflow-hidden rounded-lg border border-glass-border shadow-[0_24px_48px_rgb(0_0_0/0.45)]"
          style={{ ...frame, background: fillCss(look.fill) }}
        >
          <div
            className="relative overflow-hidden"
            style={{
              ...recording,
              borderRadius: radius,
              boxShadow: `0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`,
              outline: `${border.width}px solid ${border.color}`,
              outlineOffset: -border.width,
            }}
          >
            <video
              className="absolute max-w-none object-cover"
              style={{
                ...rectStyle(video),
                transform: `scale(${zoom})`,
                transformOrigin: `${centre.x * 100}% ${centre.y * 100}%`,
                transition: `transform ${ZOOM_EASE.ms}ms cubic-bezier(${ZOOM_EASE.curve.join(", ")})`,
              }}
              {...playback.videoProps}
            />
          </div>
        </div>
      </div>
    </Island>
  );
}
