import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { CheckMenuItem, Menu, MenuItem } from "@tauri-apps/api/menu";
import {
  useInvokeOnMount,
  useOneAtATime,
  useRustValue,
  useTauriEvent,
} from "@/hooks/useTauri";
import type { Animation, Devices, Mode, RecordingStatus } from "@/lib/bindings";
import type { Size } from "@/lib/geometry";
import { elapsedMsAt, parseOptions } from "./bar";

/** A status from Rust, and when it arrived, so the timer can count on from it. */
type Timer = { status: RecordingStatus; receivedAt: number };

export function useRecordBar() {
  const [pickerMode, setPickerMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState<Timer>({
    status: { phase: "idle", error: null, elapsedMs: 0 },
    receivedAt: 0,
  });
  const oneAtATime = useOneAtATime();
  const { phase } = timer.status;

  function applyStatus(status: RecordingStatus) {
    setTimer({ status, receivedAt: Date.now() });
    if (status.error) setError(status.error);
  }
  useRustValue("recording_status", "recording-status", applyStatus);
  useTauriEvent("picker-closed", () => setPickerMode(null));

  /** Runs `job` unless another is still running, showing its error on the bar if it fails. */
  async function attempt(job: () => Promise<unknown>) {
    try {
      await oneAtATime(job);
    } catch (err) {
      setError(String(err));
    }
  }

  return {
    /** The mode whose picker is open. */
    pickerMode,
    phase,
    /** Read with `useElapsedMs`, so only the timer redraws as it counts. */
    timer,
    error,
    /** Opens or switches the picker, or closes it with null. */
    chooseMode: async (mode: Mode | null) => {
      setError(null);
      await attempt(async () => {
        if (mode) {
          await invoke("open_picker", { mode });
          setPickerMode(mode);
        } else {
          await invoke("close_picker");
        }
      });
    },
    togglePause: () =>
      attempt(() => invoke("pause_recording", { paused: phase !== "paused" })),
    // Rust asks first, because restarting deletes what's been recorded.
    restart: () => attempt(() => invoke("restart_recording")),
    stop: () => attempt(() => invoke("stop_recording")),
    dismissError: () => setError(null),
    openSettings: (anchor: HTMLElement) =>
      oneAtATime(async () =>
        popupBelow(anchor, [
          await MenuItem.new({ text: "Quit screen-recorder", action: quit }),
        ]),
      ).catch(console.error),
    quit,
    /** Tells Rust the pill's size, so the glass behind it and its click area follow. */
    shape: ({ width, height }: Size, animation: Animation | null) =>
      void invoke("shape_bar", { width, height, animation }).catch(
        console.error,
      ),
  };
}

/** The camera, microphone and system audio choices, remembered between launches. */
export function useCaptureOptions() {
  const [devices, setDevices] = useState<Devices>({
    cameras: [],
    microphones: [],
  });
  const [options, setOptions] = useState(() =>
    parseOptions(localStorage.getItem("capture-options")),
  );
  const oneAtATime = useOneAtATime();

  useInvokeOnMount("list_devices", setDevices);
  useEffect(
    () => localStorage.setItem("capture-options", JSON.stringify(options)),
    [options],
  );

  /** One menu at a time, so a double click doesn't open a second after the first. */
  async function chooseDevice(anchor: HTMLElement, kind: keyof Devices) {
    const key = kind === "cameras" ? "cameraId" : "microphoneId";
    const none = kind === "cameras" ? "No camera" : "No microphone";
    await oneAtATime(async () => {
      const found = await invoke<Devices>("list_devices");
      setDevices(found);
      const choices = [{ id: null, name: none }, ...found[kind]];
      const items = await Promise.all(
        choices.map(({ id, name }) =>
          CheckMenuItem.new({
            text: name,
            checked: id === options[key],
            action: () => setOptions((current) => ({ ...current, [key]: id })),
          }),
        ),
      );
      await popupBelow(anchor, items);
    }).catch(console.error);
  }

  return {
    /** Null when off, or when the chosen device is unplugged. */
    camera: devices.cameras.find(({ id }) => id === options.cameraId) ?? null,
    microphone:
      devices.microphones.find(({ id }) => id === options.microphoneId) ?? null,
    systemAudio: options.systemAudio,
    chooseCamera: (anchor: HTMLElement) => chooseDevice(anchor, "cameras"),
    chooseMicrophone: (anchor: HTMLElement) =>
      chooseDevice(anchor, "microphones"),
    toggleSystemAudio: () =>
      setOptions((current) => ({
        ...current,
        systemAudio: !current.systemAudio,
      })),
  };
}

/**
 * Counts on from Rust's recorded time while recording, and holds still while paused. It ticks ten
 * times a second, so call it from the component that shows the time.
 */
export function useElapsedMs({ status, receivedAt }: Timer): number {
  const [now, setNow] = useState(receivedAt);
  const isRecording = status.phase === "recording";
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [isRecording]);
  return elapsedMsAt(status, receivedAt, now);
}

function quit() {
  return invoke("quit").catch(console.error);
}

// Native menus, because the bar window is too short to hold a web dropdown.
async function popupBelow(
  anchor: HTMLElement,
  items: (MenuItem | CheckMenuItem)[],
) {
  const { left, bottom } = anchor.getBoundingClientRect();
  const menu = await Menu.new({ items });
  await menu.popup(new LogicalPosition(left, bottom + 6));
}
