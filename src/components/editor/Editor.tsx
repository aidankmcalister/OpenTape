import type { ComponentProps } from "react";
import { useEditor } from "@/hooks/useEditor";
import { useOpenedRecording } from "@/hooks/useOpenedRecording";
import { cn } from "@/lib/utils";
import BackgroundPanel from "./BackgroundPanel";
import Header from "./Header";
import Rail from "./Rail";
import Stage from "./Stage";
import Timeline from "./Timeline";

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
        <Timeline editor={editor} />
      </div>
    </div>
  );
}

export function Island({ className, ...props }: ComponentProps<"div">) {
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
