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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MorphLabel,
  MorphPill,
  PillDivider,
  PillMessage,
} from "@/components/Pill";
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
        active={barLayer(bar.phase, bar.error, bar.hasScreenAccess)}
        onShape={bar.shape}
        layerClassName="gap-1 p-2"
        layers={{
          setup: <Setup bar={bar} options={options} />,
          permission: (
            <>
              <CircleAlert className="ml-3 size-4 shrink-0 text-destructive" />
              <span className="px-2 text-xs">
                {bar.hasOpenedSettings
                  ? "Turn on OpenTape there, then quit and reopen it to record."
                  : "Turn on Screen Recording in System Settings to record your screen."}
              </span>
              <Button
                variant={bar.hasOpenedSettings ? "ghost" : "default"}
                size="pill"
                onClick={bar.openScreenSettings}
              >
                Open System Settings
              </Button>
              {bar.hasOpenedSettings ? (
                <Button size="pill" onClick={bar.relaunch}>
                  Quit and Reopen
                </Button>
              ) : null}
            </>
          ),
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
        aria-label="Hide the record bar"
        onClick={bar.hide}
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
      <Tooltip open={bar.hoveredName === "camera"}>
        <TooltipTrigger
          render={<span data-hover="camera" className="inline-flex" />}
        >
          <DeviceButton
            isOn={false}
            icon={<Video />}
            label="Camera"
            disabled
            onClick={() => {}}
          />
        </TooltipTrigger>
        <TooltipContent side="right">Coming soon</TooltipContent>
      </Tooltip>
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

function DeviceButton({
  isOn,
  icon,
  label,
  disabled,
  onClick,
}: {
  isOn: boolean;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: (anchor: HTMLElement) => void;
}) {
  return (
    <Button
      variant={isOn ? "selected" : "ghost"}
      size="pill"
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
    >
      {icon}
      <MorphLabel text={label} className="max-w-40 truncate" />
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
      {bar.timer.status.microphoneRefused ? (
        <PillMessage icon={<MicOff />}>Microphone access is off</PillMessage>
      ) : null}
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

function Elapsed({ timer }: { timer: Bar["timer"] }) {
  const elapsedMs = useElapsedMs(timer);
  return (
    <span className="pr-8 pl-3 font-mono text-sm tabular-nums">
      {formatClock(elapsedMs)}
    </span>
  );
}
