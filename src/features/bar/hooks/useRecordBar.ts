import { useCallback, useEffect, useState } from "react";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { quitApp, shapeBar } from "@/features/bar/lib/bar";
import type { Animation } from "@/lib/bindings/Animation";
import type { Mode } from "@/lib/bindings/Mode";
import type { Phase } from "@/lib/bindings/Phase";
import type { RecordingStatus } from "@/lib/bindings/RecordingStatus";
import { EVENTS } from "@/lib/events";
import type { Size } from "@/lib/geometry";
import { popupActions } from "@/lib/menus";
import { closePicker, openPicker } from "@/features/picker/lib/picker";
import {
  pauseRecording,
  recordingStatus,
  restartRecording,
  stopRecording,
} from "@/features/recording/lib/recording";

export type RecordBar = {
  /** The mode whose picker is open. */
  active: Mode | null;
  phase: Phase;
  /** Recorded time, not counting pauses. */
  elapsedMs: number;
  error: string | null;
  /** Opens or switches the picker, or closes it with null. */
  choose: (mode: Mode | null) => Promise<void>;
  togglePause: () => Promise<void>;
  /** Rust asks first, because restarting deletes what's been recorded. */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  openSettings: (anchor: HTMLElement) => Promise<void>;
  quit: () => Promise<void>;
  /** Hears the pill's new size, so Rust's glass and click area follow it. */
  shape: (size: Size, animation: Animation | null) => void;
};

export function useRecordBar(): RecordBar {
  const [active, setActive] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const received = useRecordingStatus(setError);
  const { status } = received;
  const elapsedMs = useElapsedMs(received);

  useTauriEvent(EVENTS.pickerClosed, () => setActive(null));

  /** Runs `job`, showing its error on the bar if it fails. */
  async function attempt(job: () => Promise<unknown>) {
    try {
      await job();
    } catch (err) {
      setError(String(err));
    }
  }

  async function choose(mode: Mode | null) {
    setError(null);
    await attempt(async () => {
      if (mode) {
        await openPicker(mode);
        setActive(mode);
      } else {
        await closePicker();
      }
    });
  }

  async function openSettings(anchor: HTMLElement) {
    await popupActions(anchor, [
      { label: "Quit screen-recorder", run: () => void quitApp() },
    ]);
  }

  return {
    active,
    phase: status.phase,
    elapsedMs,
    error,
    choose,
    togglePause: () => attempt(() => pauseRecording(status.phase !== "paused")),
    restart: () => attempt(restartRecording),
    stop: () => attempt(stopRecording),
    dismissError: () => setError(null),
    openSettings,
    quit: quitApp,
    shape: (size, animation) =>
      void shapeBar(size.width, size.height, animation),
  };
}

/** A status from Rust, and when it arrived, so the timer can count on from it. */
type Received = { status: RecordingStatus; receivedAt: number };

const IDLE: Received = {
  status: { phase: "idle", error: null, elapsedMs: 0 },
  receivedAt: 0,
};

/** Follows Rust's recording status, passing any error to `onError`. */
function useRecordingStatus(onError: (message: string) => void): Received {
  const [received, setReceived] = useState(IDLE);
  const apply = useCallback(
    (status: RecordingStatus) => {
      setReceived({ status, receivedAt: Date.now() });
      if (status.error) onError(status.error);
    },
    [onError],
  );
  useEffect(() => void recordingStatus().then(apply), [apply]);
  useTauriEvent(EVENTS.recordingStatus, apply);
  return received;
}

/** Counts on from Rust's recorded time while recording; holds still while paused. */
function useElapsedMs({ status, receivedAt }: Received): number {
  const [now, setNow] = useState(receivedAt);
  const isRecording = status.phase === "recording";
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [isRecording]);
  if (!isRecording) return status.elapsedMs;
  return status.elapsedMs + Math.max(now - receivedAt, 0);
}
