import { useEffect, useState } from "react";
import { quitApp } from "@/lib/app";
import { EVENTS, subscribe } from "@/lib/events";
import { popupActions } from "@/lib/menus";
import { closePicker, openPicker, type Mode } from "@/lib/picker";
import {
  pauseRecording,
  recordingStatus,
  restartRecording,
  stopRecording,
  type Phase,
  type RecordingStatus,
} from "@/lib/recording";

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
};

export function useRecordBar(): RecordBar {
  const [active, setActive] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useRecordingStatus(setError);
  const elapsedMs = useElapsedMs(status);

  useEffect(() => subscribe(EVENTS.pickerClosed, () => setActive(null)), []);

  const fail = (err: unknown) => setError(String(err));

  async function choose(mode: Mode | null) {
    setError(null);
    try {
      if (mode) {
        await openPicker(mode);
        setActive(mode);
      } else {
        await closePicker();
      }
    } catch (err) {
      fail(err);
    }
  }

  async function togglePause() {
    try {
      await pauseRecording(status.phase !== "paused");
    } catch (err) {
      fail(err);
    }
  }

  async function restart() {
    try {
      await restartRecording();
    } catch (err) {
      fail(err);
    }
  }

  async function stop() {
    try {
      await stopRecording();
    } catch (err) {
      fail(err);
    }
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
    togglePause,
    restart,
    stop,
    dismissError: () => setError(null),
    openSettings,
    quit: quitApp,
  };
}

const IDLE: RecordingStatus = { phase: "idle", error: null, elapsedMs: 0 };

/** Follows Rust's recording status, passing any error to `onError`. */
function useRecordingStatus(
  onError: (message: string) => void,
): RecordingStatus {
  const [status, setStatus] = useState(IDLE);
  useEffect(() => {
    const apply = (next: RecordingStatus) => {
      setStatus(next);
      if (next.error) onError(next.error);
    };
    void recordingStatus().then(apply);
    return subscribe(EVENTS.recordingStatus, apply);
  }, [onError]);
  return status;
}

/** Counts on from Rust's recorded time while recording; holds still while paused. */
function useElapsedMs(status: RecordingStatus): number {
  const [elapsedMs, setElapsedMs] = useState(status.elapsedMs);
  useEffect(() => {
    setElapsedMs(status.elapsedMs);
    if (status.phase !== "recording") return;
    const receivedAt = Date.now();
    const timer = setInterval(
      () => setElapsedMs(status.elapsedMs + Date.now() - receivedAt),
      100,
    );
    return () => clearInterval(timer);
  }, [status]);
  return elapsedMs;
}
