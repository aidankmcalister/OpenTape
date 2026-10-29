import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";
import { usePermissions } from "@/hooks/usePermissions";
import { usePointerHover } from "@/hooks/usePointerHover";
import {
  useInvokeOnMount,
  useOneAtATime,
  useRustValue,
  useTauriEvent,
} from "@/hooks/useTauri";
import { useUpdate } from "@/hooks/useUpdate";
import type {
  Animation,
  Countdown,
  Devices,
  MenuChoice,
  Mode,
  RecordingStatus,
} from "@/lib/bindings";
import type { Size } from "@/lib/geometry";
import { barLayer, elapsedMsAt, parseOptions } from "@/lib/bar/bar";
import { newsOf } from "@/lib/update";

type Timer = { status: RecordingStatus; receivedAt: number };

export function useRecordBar() {
  const [pickerMode, setPickerMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [isUpdateHidden, setIsUpdateHidden] = useState(false);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const {
    permissions,
    showWindow: showPermissions,
    restart: relaunch,
  } = usePermissions();
  const update = useUpdate();
  if (!hasCheckedOnce && update.status.state !== "checking")
    setHasCheckedOnce(true);
  const lastMode = useRef<Mode>("display");
  const [timer, setTimer] = useState<Timer>({
    status: {
      phase: "idle",
      error: null,
      elapsedMs: 0,
      microphoneRefused: false,
      countdown: null,
    },
    receivedAt: 0,
  });
  const oneAtATime = useOneAtATime();
  const { phase } = timer.status;
  const screenRecording = permissions?.screenRecording;
  const layer = barLayer({
    phase,
    isCountingDown: timer.status.countdown !== null,
    screenRecording,
    error,
    update: isUpdateHidden || pickerMode ? null : newsOf(update.status),
  });

  function applyStatus(status: RecordingStatus) {
    setTimer({ status, receivedAt: Date.now() });
    if (status.countdown) setCountdown(status.countdown);
    if (status.error) setError(status.error);
  }
  useRustValue("recording_status", "recording-status", applyStatus);
  useTauriEvent("picker-closed", () => setPickerMode(null));
  useTauriEvent("new-recording", (mode) => {
    if (phase !== "idle" || pickerMode) return;
    if (screenRecording === "allowed")
      void chooseMode(mode ?? lastMode.current);
    else showPermissions();
  });
  useEffect(() => {
    if (hasCheckedOnce) invoke("bar_ready").catch(console.error);
  }, [hasCheckedOnce]);
  useEffect(() => {
    const followVisibility = () => {
      setIsVisible(!document.hidden);
      if (document.hidden) setIsUpdateHidden(false);
    };
    document.addEventListener("visibilitychange", followVisibility);
    return () =>
      document.removeEventListener("visibilitychange", followVisibility);
  }, []);
  const { hoveredName, setPointer } = usePointerHover();
  useTauriEvent("bar-pointer", setPointer, "window");

  async function attempt(job: () => Promise<unknown>) {
    try {
      await oneAtATime(job);
    } catch (err) {
      setError(String(err));
    }
  }

  async function chooseMode(mode: Mode | null) {
    setError(null);
    await attempt(async () => {
      if (mode) {
        await invoke("open_picker", { mode });
        setPickerMode(mode);
        lastMode.current = mode;
      } else {
        await invoke("close_picker");
      }
    });
  }

  return {
    pickerMode,
    phase,
    layer,
    isReady: hasCheckedOnce,
    isOffScreen: !hasCheckedOnce || !isVisible,
    countdown,
    timer,
    error,
    update,
    hoveredName,
    chooseMode,
    showPermissions,
    hideUpdate: () => setIsUpdateHidden(true),
    relaunch,
    togglePause: () =>
      attempt(() => invoke("pause_recording", { paused: phase !== "paused" })),
    restart: () => attempt(() => invoke("restart_recording")),
    stop: () => attempt(() => invoke("stop_recording")),
    cancelCountdown: () => void invoke("cancel_countdown").catch(console.error),
    dismissError: () => setError(null),
    openSettings: (anchor: HTMLElement) =>
      oneAtATime(async () =>
        popupBelow(anchor, [
          await MenuItem.new({
            text: "Restore previous recording",
            enabled: await invoke<boolean>("can_restore_recording"),
            action: () => void invoke("restore_recording").catch(console.error),
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Settings…",
            action: () => void invoke("open_settings").catch(console.error),
          }),
          await MenuItem.new({
            ...(await invoke<MenuChoice>("update_menu")),
            action: () =>
              void invoke("choose_update_menu").catch(console.error),
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({ text: "Quit OpenTape", action: quit }),
        ]),
      ).catch(console.error),
    hide: () => void invoke("hide_bar").catch(console.error),
    shape: ({ width, height }: Size, animation: Animation | null) =>
      void invoke("shape_bar", { width, height, animation }).catch(
        console.error,
      ),
  };
}

export function useCaptureOptions() {
  const [devices, setDevices] = useState<Devices>({
    cameras: [],
    microphones: [],
  });
  const [options, setOptions] = useState(() =>
    parseOptions(localStorage.getItem("capture-options")),
  );
  const oneAtATime = useOneAtATime();
  const microphone =
    devices.microphones.find(({ id }) => id === options.microphoneId) ?? null;
  const microphoneId = microphone?.id ?? null;
  const { systemAudio } = options;

  useInvokeOnMount("list_devices", setDevices);
  useEffect(
    () => localStorage.setItem("capture-options", JSON.stringify(options)),
    [options],
  );
  useEffect(() => {
    invoke("set_capture_inputs", {
      cameraId: null,
      microphoneId,
      systemAudio,
    }).catch(console.error);
  }, [microphoneId, systemAudio]);

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
    microphone,
    systemAudio,
    chooseMicrophone: (anchor: HTMLElement) =>
      void chooseDevice(anchor, "microphones"),
    toggleSystemAudio: () =>
      setOptions((current) => ({
        ...current,
        systemAudio: !current.systemAudio,
      })),
  };
}

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
  void invoke("quit").catch(console.error);
}

async function popupBelow(
  anchor: HTMLElement,
  items: (MenuItem | CheckMenuItem | PredefinedMenuItem)[],
) {
  const { left, bottom } = anchor.getBoundingClientRect();
  const menu = await Menu.new({ items });
  await menu.popup(new LogicalPosition(left, bottom + 6));
}
