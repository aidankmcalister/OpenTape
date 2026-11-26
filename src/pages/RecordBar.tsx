import { type ReactNode, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppWindow,
  ChevronDown,
  CircleAlert,
  Keyboard,
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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MorphLabel,
  MorphPill,
  PillDivider,
  PillMessage,
  PillTip,
  ProgressRing,
} from "@/components/Pill";
import UpdateIcon from "@/components/UpdateIcon";
import { useAppSettings } from "@/hooks/useAppSettings";
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
  const app = useAppSettings();
  const recordsKeys = app.settings?.recordsKeys ?? false;

  return (
    // The window is taller than the pill so tooltips have room above it.
    <div className="flex h-screen w-screen items-end justify-center">
      <MorphPill
        isDragRegion
        active={bar.layer}
        isInstant={bar.isOffScreen}
        className={cn(!bar.isReady && "opacity-0")}
        onShape={bar.shape}
        layerClassName="gap-1 p-2"
        layers={{
          setup: (
            <Setup
              bar={bar}
              options={options}
              recordsKeys={recordsKeys}
              setRecordsKeys={app.setRecordsKeys}
            />
          ),
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
          updateChecking: <UpdateLayer bar={bar} news="checking" />,
          updateUpToDate: <UpdateLayer bar={bar} news="upToDate" />,
          updateCheckFailed: <UpdateLayer bar={bar} news="checkFailed" />,
          countdown: bar.countdown ? (
            <CountingDown
              countdown={bar.countdown}
              hasMicrophone={options.microphone !== null}
              onCancel={bar.cancelCountdown}
            />
          ) : null,
          recording: (
            <Recording bar={bar} hasMicrophone={options.microphone !== null} />
          ),
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
  recordsKeys,
  setRecordsKeys,
}: {
  bar: Bar;
  options: ReturnType<typeof useCaptureOptions>;
  recordsKeys: boolean;
  setRecordsKeys: (isOn: boolean) => void;
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
        label="System audio"
        onClick={options.toggleSystemAudio}
      />
      <PillTip
        label={`Record keystrokes: ${recordsKeys ? "on" : "off"}`}
        hovered={bar.hoveredName}
      >
        <Button
          variant={recordsKeys ? "selected" : "ghost"}
          size="icon-pill"
          aria-label="Record keystrokes"
          aria-pressed={recordsKeys}
          onClick={() => setRecordsKeys(!recordsKeys)}
        >
          <Keyboard />
        </Button>
      </PillTip>
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
  const [title, detail] = {
    downloading: [
      `Downloading ${version}`,
      `${progress.percent}%, ${progress.detail}`,
    ],
    ready: [`OpenTape ${version} is ready`, "Restart to finish updating"],
    failed: ["Could not update", "Check your connection and try again"],
    available: [
      `OpenTape ${version} is available`,
      `You have ${currentVersion}`,
    ],
    checking: ["Checking for updates", `You have ${currentVersion}`],
    upToDate: ["OpenTape is up to date", `Version ${currentVersion}`],
    checkFailed: [
      "Could not check for updates",
      "Check your connection and try again",
    ],
  }[news];
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
      {news === "downloading" ? null : news === "checking" ||
        news === "upToDate" ? (
        <Button variant="ghost" size="pill" onClick={bar.doneChecking}>
          {news === "checking" ? "Cancel" : "Done"}
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="pill" onClick={bar.hideUpdate}>
            Later
          </Button>
          <Button
            size="pill"
            onClick={
              news === "ready"
                ? restart
                : news === "checkFailed"
                  ? bar.checkForUpdate
                  : install
            }
          >
            {news === "ready"
              ? "Restart"
              : news === "failed" || news === "checkFailed"
                ? "Try again"
                : "Update"}
          </Button>
        </>
      )}
    </>
  );
}

function Recording({
  bar,
  hasMicrophone,
}: {
  bar: Bar;
  hasMicrophone: boolean;
}) {
  const isPaused = bar.phase === "paused";
  const isRunning = bar.phase === "recording" || isPaused;
  const { microphoneRefused } = bar.timer.status;
  return (
    <>
      <span
        className={cn(
          "ml-3 size-2 rounded-full",
          isPaused ? "bg-muted-foreground" : "bg-record",
        )}
      />
      <Elapsed timer={bar.timer} />
      {microphoneRefused ? (
        <PillMessage icon={<MicOff />}>Microphone access is off</PillMessage>
      ) : hasMicrophone ? (
        <MicLevel isListening={bar.phase === "recording"} />
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

/** How tall each bar can get, tallest in the middle, so the meter reads like a voice. */
const BAR_SHAPE = [0.45, 0.8, 1, 0.7, 0.5];
const QUIET = BAR_SHAPE.map(() => 0);

/**
 * A peak level from 0 to 1 as a bar height from 0 to 1, on a decibel scale: -50 dB and below is
 * flat and -10 dB is full, so normal speech fills most of the bar.
 */
const levelHeight = (level: number) =>
  Math.min(1, Math.max(0, (20 * Math.log10(level) + 50) / 40));

/**
 * The mic's loudness as five small bars that rise together, each by its own share with a little
 * jitter so they move apart. Flat while paused.
 */
function MicLevel({ isListening }: { isListening: boolean }) {
  const [heights, setHeights] = useState(QUIET);
  useEffect(() => {
    if (!isListening) return;
    const timer = setInterval(() => {
      void invoke<number>("mic_level").then((level) =>
        setHeights(
          BAR_SHAPE.map(
            (most) => levelHeight(level) * most * (0.6 + Math.random() * 0.4),
          ),
        ),
      );
    }, 50);
    return () => {
      clearInterval(timer);
      setHeights(QUIET);
    };
  }, [isListening]);
  return (
    <span className="-ml-5 mr-5 flex h-4 items-center gap-0.5" aria-hidden>
      {heights.map((height, index) => (
        <span
          key={index}
          className="w-0.5 rounded-full bg-primary transition-[height] duration-75"
          style={{ height: 2 + height * 14 }}
        />
      ))}
    </span>
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
