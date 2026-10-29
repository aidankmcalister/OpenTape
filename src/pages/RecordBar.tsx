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
  RotateCw,
  Scan,
  Settings,
  Square,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
  ProgressRing,
} from "@/components/Pill";
import UpdateIcon from "@/components/UpdateIcon";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Countdown } from "@/lib/bindings";
import { downloadProgress, type News } from "@/lib/update";
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
        active={bar.layer}
        isInstant={bar.isOffScreen}
        className={cn(!bar.isReady && "opacity-0")}
        onShape={bar.shape}
        layerClassName="gap-1 p-2"
        layers={{
          setup: <Setup bar={bar} options={options} />,
          permission: (
            <>
              <CircleAlert className="ml-3 size-4 shrink-0 text-destructive" />
              <span className="pr-4 pl-2 text-xs">
                Screen Recording is off.
              </span>
              <Button size="pill" onClick={bar.showPermissions}>
                Review permissions
              </Button>
            </>
          ),
          restart: (
            <>
              <RotateCw className="ml-3 size-4 shrink-0 text-muted-foreground" />
              <span className="pr-4 pl-2 text-xs">
                Restart OpenTape to start recording.
              </span>
              <Button variant="ghost" size="pill" onClick={bar.showPermissions}>
                Permissions
              </Button>
              <Button size="pill" onClick={bar.relaunch}>
                <RotateCw />
                Restart
              </Button>
            </>
          ),
          updateAvailable: <UpdateLayer bar={bar} news="available" />,
          updateDownloading: <UpdateLayer bar={bar} news="downloading" />,
          updateReady: <UpdateLayer bar={bar} news="ready" />,
          updateFailed: <UpdateLayer bar={bar} news="failed" />,
          countdown: bar.countdown ? (
            <CountingDown
              countdown={bar.countdown}
              hasMicrophone={options.microphone !== null}
              onCancel={bar.cancelCountdown}
            />
          ) : null,
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
        disabled={bar.pickerMode !== null || bar.phase !== "idle"}
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

function CountingDown({
  countdown: { seconds, secondsLeft, target },
  hasMicrophone,
  onCancel,
}: {
  countdown: Countdown;
  hasMicrophone: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <ProgressRing
        fraction={(secondsLeft - 1) / seconds}
        sweepsFrom={secondsLeft / seconds}
        className="ml-1 size-9 font-heading text-heading font-semibold"
      >
        {secondsLeft}
      </ProgressRing>
      <span className="flex flex-col pr-8 pl-2 tabular-nums">
        <span>Starting in {secondsLeft}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {[target, hasMicrophone ? "mic on" : "mic off"]
            .filter(Boolean)
            .join(", ")}
        </span>
      </span>
      <Button variant="ghost" size="pill" onClick={onCancel}>
        Cancel
        <Kbd>esc</Kbd>
      </Button>
    </>
  );
}

function UpdateLayer({ bar, news }: { bar: Bar; news: News }) {
  const { status, currentVersion, install, restart } = bar.update;
  const version = "version" in status ? status.version : null;
  const progress = downloadProgress(status) ?? { percent: 0, detail: "" };
  const [title, detail] =
    news === "downloading"
      ? [`Downloading ${version}`, `${progress.percent}%, ${progress.detail}`]
      : news === "ready"
        ? [`OpenTape ${version} is ready`, "Restart to finish updating"]
        : news === "failed"
          ? ["Could not update", "Check your connection and try again"]
          : [`OpenTape ${version} is available`, `You have ${currentVersion}`];
  return (
    <>
      <UpdateIcon
        news={news}
        percent={progress.percent}
        className="ml-1 size-9"
      />
      <span className="flex w-60 flex-col pl-2 tabular-nums">
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {detail}
        </span>
      </span>
      <Button variant="ghost" size="pill" onClick={bar.hideUpdate}>
        {news === "downloading" ? "Hide" : "Later"}
      </Button>
      {news === "downloading" ? null : (
        <Button size="pill" onClick={news === "ready" ? restart : install}>
          {news === "ready"
            ? "Restart"
            : news === "failed"
              ? "Try again"
              : "Update"}
        </Button>
      )}
    </>
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
