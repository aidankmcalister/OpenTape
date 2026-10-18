import type { ComponentProps, ReactNode } from "react";
import {
  AppWindow,
  ChevronDown,
  CircleAlert,
  Mic,
  MicOff,
  Monitor,
  MonitorSpeaker,
  Scan,
  Settings,
  Square,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useBarMorph } from "@/hooks/useBarMorph";
import {
  useCaptureOptions,
  type CaptureOptions,
} from "@/hooks/useCaptureOptions";
import {
  useRecordBar,
  type RecordBar as RecordBarState,
} from "@/hooks/useRecordBar";
import { formatClock } from "@/lib/time";
import Pill, { PillDivider, pillItem } from "./Pill";

const MODES = [
  { mode: "display", label: "Display", Icon: Monitor },
  { mode: "window", label: "Window", Icon: AppWindow },
  { mode: "area", label: "Area", Icon: Scan },
] as const;

type BarState = "setup" | "recording" | "error";

export default function RecordBar() {
  const bar = useRecordBar();
  const options = useCaptureOptions();
  const morph = useBarMorph(stateOf(bar));

  return (
    <div className="flex h-screen w-screen justify-center">
      <Pill
        translucent
        data-tauri-drag-region
        className="relative block shrink-0 overflow-hidden p-0 transition-[width] duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        style={morph.pillStyle}
      >
        <Layer {...morph.layerProps("setup")}>
          <Setup bar={bar} options={options} />
        </Layer>
        <Layer {...morph.layerProps("recording")}>
          <Recording bar={bar} />
        </Layer>
        <Layer {...morph.layerProps("error")}>
          <ErrorMessage bar={bar} />
        </Layer>
      </Pill>
    </div>
  );
}

function stateOf(bar: RecordBarState): BarState {
  if (bar.phase === "recording" || bar.phase === "stopping") return "recording";
  return bar.error ? "error" : "setup";
}

/**
 * One state of the bar, kept at its natural size so it's clipped, never squeezed, while the
 * pill animates. The leaving state fades out fast; the arriving one fades in just after.
 */
function Layer(props: ComponentProps<"div">) {
  return (
    <div
      data-tauri-drag-region
      className="absolute top-0 left-1/2 flex w-max -translate-x-1/2 items-center gap-1 p-2 transition-[opacity,scale,filter] ease-out motion-reduce:transition-none data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:blur-xs data-[active=false]:duration-150 data-[active=true]:delay-100 data-[active=true]:duration-300"
      {...props}
    />
  );
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
      <button
        aria-label="Quit"
        onClick={() => void bar.quit()}
        className={pillItem({ size: "icon" })}
      >
        <X />
      </button>
      <PillDivider />
      {MODES.map(({ mode, label, Icon }) => {
        const isActive = bar.active === mode;
        return (
          <button
            key={mode}
            aria-pressed={isActive}
            onClick={() => void bar.choose(isActive ? null : mode)}
            disabled={bar.phase !== "idle"}
            className={pillItem({ active: isActive })}
          >
            <Icon />
            {label}
          </button>
        );
      })}
      <PillDivider />
      <button
        onClick={(event) => void options.chooseCamera(event.currentTarget)}
        className={pillItem({ active: Boolean(options.camera) })}
      >
        {options.camera ? <Video /> : <VideoOff />}
        <DeviceName>{options.camera?.name ?? "No camera"}</DeviceName>
      </button>
      <button
        onClick={(event) => void options.chooseMicrophone(event.currentTarget)}
        className={pillItem({ active: Boolean(options.microphone) })}
      >
        {options.microphone ? <Mic /> : <MicOff />}
        <DeviceName>{options.microphone?.name ?? "No microphone"}</DeviceName>
      </button>
      <button
        aria-pressed={options.systemAudio}
        onClick={options.toggleSystemAudio}
        className={pillItem({ active: options.systemAudio })}
      >
        {options.systemAudio ? (
          <MonitorSpeaker />
        ) : (
          <Slashed>
            <MonitorSpeaker />
          </Slashed>
        )}
        {options.systemAudio ? "System audio" : "No system audio"}
      </button>
      <PillDivider />
      <button
        aria-label="Settings"
        onClick={(event) => void bar.openSettings(event.currentTarget)}
        className={pillItem({ className: "gap-1 px-3" })}
      >
        <Settings />
        <ChevronDown className="size-3!" />
      </button>
    </>
  );
}

/** Device names can be long, so they're capped to keep the bar's size steady. */
function DeviceName({ children }: { children: string }) {
  return <span className="max-w-40 truncate">{children}</span>;
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
  return (
    <>
      <span className="ml-3 size-2 rounded-full bg-record" />
      <span className="px-3 font-mono text-sm tabular-nums">
        {formatClock(bar.elapsedMs)}
      </span>
      <button
        aria-label="Stop recording"
        onClick={() => void bar.stop()}
        disabled={bar.phase === "stopping"}
        className="grid size-10 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary/80 disabled:opacity-50"
      >
        <Square className="size-3.5 fill-current" />
      </button>
    </>
  );
}

function ErrorMessage({ bar }: { bar: RecordBarState }) {
  return (
    <>
      <CircleAlert className="ml-3 size-4 shrink-0 text-destructive" />
      <span className="max-w-80 truncate px-2 text-xs" title={bar.error}>
        {bar.error}
      </span>
      <button
        aria-label="Dismiss"
        onClick={bar.dismissError}
        className={pillItem({ size: "icon" })}
      >
        <X />
      </button>
    </>
  );
}
