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
import {
  useCaptureOptions,
  type CaptureOptions,
} from "@/features/bar/hooks/useCaptureOptions";
import {
  useRecordBar,
  type RecordBar as RecordBarState,
} from "@/features/bar/hooks/useRecordBar";
import type { Mode } from "@/lib/bindings/Mode";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import MorphPill from "@/components/MorphPill";
import { PillDivider } from "@/components/Pill";

const MODES = [
  { mode: "display", label: "Display", Icon: Monitor },
  { mode: "window", label: "Window", Icon: AppWindow },
  { mode: "area", label: "Area", Icon: Scan },
] as const;

type BarState = "setup" | "recording" | "error";

export default function RecordBar() {
  const bar = useRecordBar();
  const options = useCaptureOptions();

  return (
    <div className="flex h-screen w-screen justify-center">
      <MorphPill
        translucent
        isDragRegion
        active={stateOf(bar)}
        onShape={bar.shape}
        layerClassName="gap-1 p-2"
        layers={{
          setup: <Setup bar={bar} options={options} />,
          recording: <Recording bar={bar} />,
          error: <ErrorMessage bar={bar} />,
        }}
      />
    </div>
  );
}

function stateOf(bar: RecordBarState): BarState {
  if (bar.phase !== "idle") return "recording";
  return bar.error ? "error" : "setup";
}

function Setup({
  bar,
  options,
}: {
  bar: RecordBarState;
  options: CaptureOptions;
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
        value={bar.active ? [bar.active] : []}
        onValueChange={(modes) =>
          void bar.choose((modes[0] as Mode | undefined) ?? null)
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
            <Slashed>
              <MonitorSpeaker />
            </Slashed>
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

/** Opens a native menu of devices. Long names are capped so the bar keeps a steady size. */
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

/** Crosses out an icon the way Lucide's own "off" icons do. */
function Slashed({ children }: { children: ReactNode }) {
  return (
    <span className="relative grid place-items-center">
      {children}
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
  );
}

function Recording({ bar }: { bar: RecordBarState }) {
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
      <span className="pr-8 pl-3 font-mono text-sm tabular-nums">
        {formatClock(bar.elapsedMs)}
      </span>
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

function ErrorMessage({ bar }: { bar: RecordBarState }) {
  return (
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
  );
}
