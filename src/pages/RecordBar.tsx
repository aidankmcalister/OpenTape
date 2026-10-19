import type { ReactNode } from "react";
import {
  AppWindow,
  ChevronDown,
  CircleAlert,
  Mic,
  MicOff,
  Monitor,
  MonitorSpeaker,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Settings,
  Square,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MorphPill, PillDivider } from "@/components/Pill";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { barLayer } from "@/lib/bar/bar";
import {
  useCaptureOptions,
  useElapsedMs,
  useRecordBar,
} from "@/hooks/bar/useRecordBar";

type Bar = ReturnType<typeof useRecordBar>;

const MODES = [
  { mode: "display", label: "Display", Icon: Monitor },
  { mode: "window", label: "Window", Icon: AppWindow },
  { mode: "area", label: "Area", Icon: Scan },
] as const;

export default function RecordBar() {
  const bar = useRecordBar();
  const options = useCaptureOptions();

  return (
    <div className="flex h-screen w-screen justify-center">
      <MorphPill
        isDragRegion
        active={barLayer(bar.phase, bar.error)}
        onShape={bar.shape}
        layerClassName="gap-1 p-2"
        layers={{
          setup: <Setup bar={bar} options={options} />,
          recording: <Recording bar={bar} />,
          error: (
            <>
              <CircleAlert className="ml-3 size-4 shrink-0 text-destructive" />
              <span
                className="max-w-80 truncate px-2 text-xs"
                title={bar.error ?? undefined}
              >
                {bar.error}
              </span>
              <Button
                variant="ghost"
                size="icon-pill"
                aria-label="Dismiss"
                onClick={bar.dismissError}
              >
                <X />
              </Button>
            </>
          ),
        }}
      />
    </div>
  );
}

function Setup({
  bar,
  options,
}: {
  bar: Bar;
  options: ReturnType<typeof useCaptureOptions>;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-pill"
        aria-label="Quit"
        onClick={() => void bar.quit()}
      >
        <X />
      </Button>
      <PillDivider />
      <ToggleGroup
        size="pill"
        spacing={1}
        value={bar.pickerMode ? [bar.pickerMode] : []}
        onValueChange={([chosen]) =>
          void bar.chooseMode(
            MODES.find(({ mode }) => mode === chosen)?.mode ?? null,
          )
        }
        disabled={bar.phase !== "idle"}
      >
        {MODES.map(({ mode, label, Icon }) => (
          <ToggleGroupItem key={mode} value={mode}>
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <PillDivider />
      <DeviceButton
        isOn={options.camera !== null}
        icon={options.camera ? <Video /> : <VideoOff />}
        label={options.camera?.name ?? "No camera"}
        onClick={options.chooseCamera}
      />
      <DeviceButton
        isOn={options.microphone !== null}
        icon={options.microphone ? <Mic /> : <MicOff />}
        label={options.microphone?.name ?? "No microphone"}
        onClick={options.chooseMicrophone}
      />
      <DeviceButton
        isOn={options.systemAudio}
        icon={
          options.systemAudio ? (
            <MonitorSpeaker />
          ) : (
            // Crossed out the way Lucide's own "off" icons are.
            <span className="relative grid place-items-center">
              <MonitorSpeaker />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className="absolute inset-0"
              >
                <path d="m2 2 20 20" />
              </svg>
            </span>
          )
        }
        label={options.systemAudio ? "System audio" : "No system audio"}
        onClick={options.toggleSystemAudio}
      />
      <PillDivider />
      <Button
        variant="ghost"
        size="pill"
        aria-label="Settings"
        className="gap-1 px-3"
        onClick={(event) => void bar.openSettings(event.currentTarget)}
      >
        <Settings />
        <ChevronDown />
      </Button>
    </>
  );
}

/** A device's menu or toggle. Long names are capped so the bar keeps a steady size. */
function DeviceButton({
  isOn,
  icon,
  label,
  onClick,
}: {
  isOn: boolean;
  icon: ReactNode;
  label: string;
  onClick: (anchor: HTMLElement) => void;
}) {
  return (
    <Button
      variant={isOn ? "selected" : "ghost"}
      size="pill"
      onClick={(event) => onClick(event.currentTarget)}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
    </Button>
  );
}

function Recording({ bar }: { bar: Bar }) {
  const isPaused = bar.phase === "paused";
  const isRunning = bar.phase === "recording" || isPaused;
  return (
    <>
      <span
        className={cn(
          "ml-3 size-2 rounded-full",
          isPaused ? "bg-muted-foreground" : "bg-record",
        )}
      />
      <Elapsed timer={bar.timer} />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-pill"
          aria-label="Restart recording"
          onClick={() => void bar.restart()}
          disabled={!isRunning}
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon-pill"
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
          onClick={() => void bar.togglePause()}
          disabled={!isRunning}
        >
          {isPaused ? <Play /> : <Pause />}
        </Button>
        <Button
          size="icon-pill"
          aria-label="Stop recording"
          onClick={() => void bar.stop()}
          disabled={!isRunning}
        >
          <Square className="fill-current" />
        </Button>
      </div>
    </>
  );
}

/** Ticks on its own, so the rest of the bar doesn't redraw ten times a second. */
function Elapsed({ timer }: { timer: Bar["timer"] }) {
  const elapsedMs = useElapsedMs(timer);
  return (
    <span className="pr-8 pl-3 font-mono text-sm tabular-nums">
      {formatClock(elapsedMs)}
    </span>
  );
}
