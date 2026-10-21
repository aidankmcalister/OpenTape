import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClockValue } from "@/hooks/useVideoClock";
import { formatTime, type Clock } from "@/lib/time";
import Island from "./Island";

/** The playback controls under the stage. */
export default function Transport({
  isPlaying,
  onTogglePlay,
  clock,
  durationMs,
}: {
  isPlaying: boolean;
  onTogglePlay: () => void;
  clock: Clock;
  durationMs: number;
}) {
  return (
    <Island className="flex h-12 shrink-0 items-center justify-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={onTogglePlay}
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
      <TimeReadout clock={clock} durationMs={durationMs} />
    </Island>
  );
}

/** The playhead's time against the length. It reads the clock itself, so only it redraws every frame. */
function TimeReadout({
  clock,
  durationMs,
}: {
  clock: Clock;
  durationMs: number;
}) {
  const time = useClockValue(clock, (seconds) => formatTime(seconds * 1000));
  return (
    <span className="font-mono text-ui text-muted-foreground tabular-nums">
      {time} <span className="text-faint">/ {formatTime(durationMs)}</span>
    </span>
  );
}
